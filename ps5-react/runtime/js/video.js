// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// <Video>: a file or stream played natively (FFmpeg demuxing, the platform's decoder), drawn by the
// presenter beneath the interface as an <Image layer> the player fills. See docs/VIDEO.md.
import {createElement, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState} from 'react';
import {openVideo} from './native.js';

const FITS = {contain: 0, cover: 1, stretch: 2};
const upscaleModel = upscale => (upscale === true ? 'artcnn' : upscale || '');

/**
 * React Native Video's core props. `source` is an app path (/app0/..., /download0/...) or an http(s)
 * URL, optionally `{uri, headers}`. Events: onLoad({duration, naturalSize, audioTracks, subtitleTracks}),
 * onProgress({currentTime, playableDuration, seekableDuration}) every `progressUpdateInterval` ms,
 * onBuffer({isBuffering}), onSeek({currentTime}), onEnd(), onError({error}), onSubtitle(text) when the
 * subtitle text showing changes, and onStatus(status) with the player's full status whenever it
 * changes. `subtitles` adds text subtitle files ({uri, language, title}) as tracks; `subtitleTrack`
 * picks the track shown (an index from subtitleTracks, -1 for none). `audioDelay` (seconds, -2 to 2) plays
 * the sound that much later than the picture, to match a TV's own delay. The ref seeks, selects an audio
 * track and reads the status. `upscale` names a network for animation that doubles a picture shown
 * bigger than its source ('artcnn' or true, 'anime4k-s', 'anime4k-m', 'anime4k-l', 'anime4k-vl',
 * 'anime4k-ul'), where the GPU runs compute shaders (the PS5); elsewhere it scales as before.
 * `compare` ({upscale, split}) shows the picture through a second model (false or '' for none) right of
 * `split` (0..1 across the picture), so two models, or one and none, can be compared on the same frame.
 * `audioOutput` is 'pcm' (decoded, the default), 'auto' (AC-3, E-AC-3 and DTS at 48 kHz go undecoded to a
 * sink whose EDID lists them; see AudioOutput.capabilities()) or 'passthrough' (those go undecoded
 * whatever the EDID says). Passed through, `volume` does nothing: the sink's volume is the one.
 */
export const Video = forwardRef(function Video(props, ref) {
  const {source, paused = false, muted = false, volume = 1, repeat = false, resizeMode = 'contain', upscale = false, compare, audio = true,
         startTime = 0, audioDelay = 0, audioOutput = 'pcm', progressUpdateInterval = 250, subtitles, subtitleTrack = -1, onLoad, onProgress, onBuffer, onSeek,
         onEnd, onError, onStatus, onSubtitle, style, ...rest} = props;
  const uri = typeof source === 'string' ? source : source?.uri;
  const headers = typeof source === 'object' ? source?.headers : undefined;
  const [name, setName] = useState('');
  const self = useRef({player: null, props, status: null, loaded: false, progressAt: 0, ended: false});
  self.current.props = props;

  useLayoutEffect(() => {
    if (!uri) return undefined;
    const state = self.current;
    state.loaded = false;
    state.ended = false;
    state.status = null;
    const listener = status => {
      const previous = state.status;
      state.status = status;
      const p = state.props;
      const changed = !previous || previous.state !== status.state || previous.paused !== status.paused ||
        previous.seeking !== status.seeking || previous.audioTrack !== status.audioTrack ||
        previous.audioPassthrough !== status.audioPassthrough;
      if (changed) p.onStatus?.(status);
      if ((previous?.subtitle ?? '') !== status.subtitle) p.onSubtitle?.(status.subtitle);
      if (status.state === 'failed') {
        if (previous?.state !== 'failed') p.onError?.({error: status.error});
        return;
      }
      if (!state.loaded && status.state !== 'loading') {
        state.loaded = true;
        p.onLoad?.({duration: status.duration, currentTime: status.position, audioTracks: status.audioTracks,
          subtitleTracks: status.subtitleTracks, naturalSize: {width: status.width, height: status.height}});
      }
      if (previous && (previous.state === 'buffering') !== (status.state === 'buffering'))
        p.onBuffer?.({isBuffering: status.state === 'buffering'});
      if (previous?.seeking && !status.seeking) p.onSeek?.({currentTime: status.position});
      if (status.state === 'ended' && !state.ended) {
        state.ended = true;
        p.onEnd?.();
      } else if (status.state !== 'ended') {
        state.ended = false;
      }
      const now = performance.now();
      if (p.onProgress && state.loaded && !status.paused && now - state.progressAt >= (p.progressUpdateInterval ?? 250)) {
        state.progressAt = now;
        p.onProgress({currentTime: status.position, playableDuration: status.buffered, seekableDuration: status.duration});
      }
    };
    const player = openVideo(uri, {paused, muted, volume, loop: repeat, start: startTime, audio, headers, audioOutput}, listener);
    player.setResizeMode(FITS[resizeMode] ?? 0);
    player.setUpscale(upscaleModel(upscale));
    if (compare) player.setCompare(upscaleModel(compare.upscale), compare.split ?? 0.5);
    player.setAudioDelay(audioDelay);
    for (const file of subtitles ?? []) player.addSubtitle(file);
    player.selectSubtitleTrack(subtitleTrack);
    state.player = player;
    setName(player.name);
    return () => {
      player.close();
      state.player = null;
    };
  }, [uri, audio]);

  useEffect(() => { self.current.player?.setPaused(paused); }, [paused]);
  useEffect(() => { self.current.player?.setMuted(muted); }, [muted]);
  useEffect(() => { self.current.player?.setVolume(volume); }, [volume]);
  useEffect(() => { self.current.player?.setLoop(repeat); }, [repeat]);
  useEffect(() => { self.current.player?.setAudioDelay(audioDelay); }, [audioDelay]);
  useEffect(() => { self.current.player?.setAudioOutput(audioOutput); }, [audioOutput]);
  useEffect(() => { self.current.player?.setResizeMode(FITS[resizeMode] ?? 0); }, [resizeMode]);
  useEffect(() => { self.current.player?.setUpscale(upscaleModel(upscale)); }, [upscale]);
  const compareModel = compare ? upscaleModel(compare.upscale) : null, split = compare?.split ?? 0.5;
  useEffect(() => { self.current.player?.setCompare(compareModel, split); }, [compareModel, split]);
  useEffect(() => { self.current.player?.selectSubtitleTrack(subtitleTrack); }, [subtitleTrack]);

  useImperativeHandle(ref, () => ({
    /** @param {number} seconds */
    seek: seconds => self.current.player?.seek(seconds),
    /** @param {number} index a track's `index` from onLoad's audioTracks, or -1 for none */
    selectAudioTrack: index => self.current.player?.selectAudioTrack(index),
    /** The latest status, or null before the first. */
    getStatus: () => self.current.status,
  }), []);

  return createElement('Image', {...rest, style: [{backgroundColor: '#000000'}, style], imageName: name, layer: true,
    resizeMode: 'stretch'});
});
Video.displayName = 'Video';
