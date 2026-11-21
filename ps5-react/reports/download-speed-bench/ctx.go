package main

import (
	"context"
	"net"
)

func connCtx(ctx context.Context, c net.Conn) context.Context {
	return context.WithValue(ctx, ctxKey{}, connID.Add(1))
}
