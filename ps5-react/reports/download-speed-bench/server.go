// Range server with a virtual file and injected per-connection / per-client caps.
package main

import (
	"crypto/tls"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type bucket struct {
	mu    sync.Mutex
	rate  float64
	avail float64
	last  time.Time
}

func newBucket(rate float64) *bucket { return &bucket{rate: rate, avail: rate / 20, last: time.Now()} }

func (b *bucket) take(n int) {
	if b == nil || b.rate <= 0 {
		return
	}
	for {
		b.mu.Lock()
		now := time.Now()
		b.avail += now.Sub(b.last).Seconds() * b.rate
		if burst := max(b.rate/20, 32768); b.avail > burst {
			b.avail = burst
		}
		b.last = now
		if b.avail >= float64(n) {
			b.avail -= float64(n)
			b.mu.Unlock()
			return
		}
		wait := time.Duration((float64(n) - b.avail) / b.rate * float64(time.Second))
		b.mu.Unlock()
		time.Sleep(wait)
	}
}

var (
	size      = flag.Int64("size", 512<<20, "file bytes")
	perConn   = flag.Float64("conn", 1.4e6, "bytes/s per connection (0 = unlimited)")
	perClient = flag.Float64("client", 0, "bytes/s shared by all connections (0 = unlimited)")
	slowFrac  = flag.Float64("slowfrac", 0, "fraction of connections that are 10x slower")
	rtt       = flag.Duration("rtt", 0, "delay before each response's first byte")
	maxBusy   = flag.Int("maxbusy", 0, "answer 500 past this many concurrent ranges (0 = never)")
	addr      = flag.String("addr", "127.0.0.1:8090", "listen")
	tlsMode   = flag.Bool("tls", false, "serve HTTPS with cert.pem/key.pem")
)

var connID atomic.Int64
var busy atomic.Int64
var requests atomic.Int64

type ctxKey struct{}

func byteAt(off int64) byte { return byte(off*131 + off>>17) }

func main() {
	flag.Parse()
	var client *bucket
	if *perClient > 0 {
		client = newBucket(*perClient)
	}
	buckets := sync.Map{}
	handler := func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		id := r.Context().Value(ctxKey{}).(int64)
		rate := *perConn
		if *slowFrac > 0 && float64(id%100) < *slowFrac*100 {
			rate /= 10
		}
		bv, _ := buckets.LoadOrStore(id, newBucket(rate))
		b := bv.(*bucket)
		if *perConn <= 0 {
			b = nil
		}
		begin, end := int64(0), *size-1
		status := 200
		if rg := r.Header.Get("Range"); strings.HasPrefix(rg, "bytes=") {
			parts := strings.SplitN(rg[6:], "-", 2)
			begin, _ = strconv.ParseInt(parts[0], 10, 64)
			if parts[1] != "" {
				end, _ = strconv.ParseInt(parts[1], 10, 64)
			}
			if end >= *size {
				end = *size - 1
			}
			status = 206
		}
		if status == 206 && end > begin && *maxBusy > 0 && busy.Add(1) > int64(*maxBusy) {
			busy.Add(-1)
			w.Header().Set("Content-Length", "0")
			w.WriteHeader(500)
			return
		} else if status == 206 && end > begin && *maxBusy > 0 {
			defer busy.Add(-1)
		}
		if *rtt > 0 {
			time.Sleep(*rtt)
		}
		h := w.Header()
		h.Set("ETag", `"bench-1"`)
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Accept-Ranges", "bytes")
		h.Set("Content-Length", strconv.FormatInt(end-begin+1, 10))
		if status == 206 {
			h.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", begin, end, *size))
		}
		w.WriteHeader(status)
		if r.Method == "HEAD" {
			return
		}
		buf := make([]byte, 16<<10)
		for off := begin; off <= end; {
			n := int64(len(buf))
			if end-off+1 < n {
				n = end - off + 1
			}
			for i := int64(0); i < n; i++ {
				buf[i] = byteAt(off + i)
			}
			b.take(int(n))
			client.take(int(n))
			if _, err := w.Write(buf[:n]); err != nil {
				return
			}
			off += n
		}
	}
	s := &http.Server{Addr: *addr, Handler: http.HandlerFunc(handler)}
	s.ConnContext = connCtx
	s.TLSNextProto = map[string]func(*http.Server, *tls.Conn, http.Handler){} // HTTP/1.1 only, like archive.org ranges
	go func() {
		for range time.Tick(10 * time.Second) {
			log.Printf("conns=%d requests=%d", connID.Load(), requests.Load())
		}
	}()
	if *tlsMode {
		log.Fatal(s.ListenAndServeTLS("cert.pem", "key.pem"))
	}
	log.Fatal(s.ListenAndServe())
}
