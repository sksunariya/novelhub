import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Read-aloud over the browser's own speech engine. No network, no API key, and
 * nothing to fall back to when the engine is missing — `supported` is false and
 * the caller hides the button.
 */

// Long utterances are the single biggest source of trouble here: Chrome stops
// speaking part-way through anything past roughly fifteen seconds and never
// fires `end`, so the queue stalls with no error to catch. Splitting the chapter
// into sentence-sized pieces keeps every utterance well inside that window, and
// it also makes pause/resume land on a sentence boundary instead of mid-word.
const CHUNK_LIMIT = 180;

const BLOCK_END = /<\/(p|div|h[1-6]|li|blockquote|tr|section|article)>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;

/**
 * Stored chapters are HTML. Reading `textContent` off a parsed document loses
 * every block boundary, which glues "...end of paragraph.Next paragraph..."
 * together and makes the engine run two sentences into one breath. Marking the
 * boundaries before parsing keeps the pauses.
 */
export const htmlToText = (html) => {
  if (!html) return '';
  const marked = String(html).replace(BLOCK_END, '$&\n').replace(LINE_BREAK, '\n');
  const parsed = new DOMParser().parseFromString(marked, 'text/html');
  return (parsed.body?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
};

/** Split on sentence ends, packing up to CHUNK_LIMIT so short lines of dialogue
 *  do not each become their own utterance (the gap between utterances is
 *  audible, and novels are mostly short lines of dialogue). */
export const chunkText = (text) => {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const sentences = clean.match(/[^.!?…]+[.!?…]*["'”’]*\s*/g) || [clean];
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  sentences.forEach((sentence) => {
    // A sentence longer than the limit on its own still has to be broken, but
    // on a word boundary — cutting mid-word makes the engine mispronounce both
    // halves.
    if (sentence.length > CHUNK_LIMIT) {
      flush();
      let rest = sentence;
      while (rest.length > CHUNK_LIMIT) {
        const space = rest.lastIndexOf(' ', CHUNK_LIMIT);
        const at = space > 0 ? space : CHUNK_LIMIT;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at);
      }
      current = rest;
      return;
    }
    if (current.length + sentence.length > CHUNK_LIMIT) flush();
    current += sentence;
  });

  flush();
  return chunks.filter(Boolean);
};

const synth = () => (typeof window !== 'undefined' ? window.speechSynthesis : null);

const useTextToSpeech = (html) => {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [status, setStatus] = useState('idle'); // idle | playing | paused

  const chunks = useMemo(() => (supported ? chunkText(htmlToText(html)) : []), [html, supported]);

  const chunksRef = useRef(chunks);
  const indexRef = useRef(0);
  const speakRef = useRef(() => {});
  // Every deliberate stop bumps this. An utterance chains to the next chunk
  // only while its own epoch is still current, which is the only guard that
  // holds across engines: cancel() delivers its final event whenever it feels
  // like it, and Firefox and WebKit report it as `end` rather than the `error`
  // Chrome sends. A flag cleared on a timer loses that race, and the browser
  // then reads the rest of the chapter aloud on whatever page the reader
  // moved to, with no UI left to stop it.
  const epochRef = useRef(0);

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  const stop = useCallback(() => {
    if (!supported) return;
    const engine = synth();
    if (!engine) return;

    epochRef.current += 1;
    engine.cancel();
    // cancel() empties the queue but leaves a paused engine paused, and a
    // paused engine silently swallows the next speak(). Without this, pausing
    // and then moving to the next chapter gives you a button that lights up
    // and says nothing. resume() on an already-empty queue clears the flag
    // without uttering anything.
    engine.resume();

    indexRef.current = 0;
    setStatus('idle');
  }, [supported]);

  const speakFrom = useCallback(
    (start) => {
      const list = chunksRef.current;
      if (start >= list.length) {
        indexRef.current = 0;
        setStatus('idle');
        return;
      }
      indexRef.current = start;

      const epoch = epochRef.current;
      const utterance = new SpeechSynthesisUtterance(list[start]);
      utterance.onend = () => {
        if (epoch !== epochRef.current) return;
        speakRef.current(start + 1);
      };
      utterance.onerror = () => {
        // A deliberate cancel() reports 'interrupted' or 'canceled' here; the
        // epoch has already moved past it, so no error type check is needed.
        if (epoch !== epochRef.current) return;
        setStatus('idle');
      };

      const engine = synth();
      engine?.speak(utterance);
      // Read the engine rather than assuming: a pause landing on a chunk
      // boundary queues this utterance behind the paused flag, and claiming
      // 'playing' there leaves the button showing Pause over silence.
      setStatus(engine?.paused ? 'paused' : 'playing');
    },
    []
  );

  useEffect(() => {
    speakRef.current = speakFrom;
  }, [speakFrom]);

  const toggle = useCallback(() => {
    if (!supported || chunksRef.current.length === 0) return;
    const engine = synth();
    if (!engine) return;

    if (status === 'playing') {
      engine.pause();
      setStatus('paused');
      return;
    }
    if (status === 'paused') {
      engine.resume();
      setStatus('playing');
      return;
    }
    // A queue left over from a previous chapter would otherwise play first,
    // and a leftover paused flag would swallow this one.
    epochRef.current += 1;
    engine.cancel();
    engine.resume();
    speakFrom(0);
  }, [status, supported, speakFrom]);

  // A new chapter means the old narration is stale. Unmount matters just as
  // much: speechSynthesis is a singleton on `window` and keeps talking over the
  // next page otherwise.
  useEffect(() => stop, [chunks, stop]);

  return {
    supported: supported && chunks.length > 0,
    status,
    isSpeaking: status === 'playing',
    toggle,
    stop,
  };
};

export default useTextToSpeech;
