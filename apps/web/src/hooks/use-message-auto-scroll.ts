import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 48;
const LAYOUT_SETTLE_DURATION_MS = 5_000;

export function useMessageAutoScroll({
  threadKey,
  lastMessageId,
  loading,
}: {
  threadKey: string;
  lastMessageId: string | null;
  loading: boolean;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const activeThreadRef = useRef(threadKey);
  const previousLastMessageIdRef = useRef<string | null>(null);
  const initialScrollDoneRef = useRef(false);
  const followingLatestRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const programmaticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopFollowing = useCallback(() => {
    followingLatestRef.current = false;
    programmaticScrollRef.current = false;
    if (programmaticTimerRef.current) {
      clearTimeout(programmaticTimerRef.current);
      programmaticTimerRef.current = null;
    }
  }, []);

  const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setScrollContainer(node);
  }, []);

  const setContentRef = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
    setContent(node);
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    followingLatestRef.current = true;
    programmaticScrollRef.current = true;
    if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: reducedMotion ? "auto" : behavior,
    });

    programmaticTimerRef.current = setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticTimerRef.current = null;
    }, LAYOUT_SETTLE_DURATION_MS);
  }, []);

  useLayoutEffect(() => {
    if (activeThreadRef.current !== threadKey) {
      activeThreadRef.current = threadKey;
      previousLastMessageIdRef.current = null;
      initialScrollDoneRef.current = false;
      followingLatestRef.current = true;
    }
    if (loading) return;

    const isInitialLoad = !initialScrollDoneRef.current;
    const hasNewMessage =
      initialScrollDoneRef.current &&
      lastMessageId !== null &&
      lastMessageId !== previousLastMessageIdRef.current;

    if (isInitialLoad || hasNewMessage) {
      scrollToLatest(isInitialLoad ? "auto" : "smooth");
    }

    initialScrollDoneRef.current = true;
    previousLastMessageIdRef.current = lastMessageId;
  }, [lastMessageId, loading, scrollContainer, scrollToLatest, threadKey]);

  useEffect(() => {
    if (!content || !scrollContainer || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (followingLatestRef.current) scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });
    observer.observe(content);
    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, [content, scrollContainer]);

  useEffect(
    () => () => {
      if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
    },
    [],
  );

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || programmaticScrollRef.current) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    followingLatestRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
  }, []);

  return {
    scrollContainerRef: setScrollContainerRef,
    contentRef: setContentRef,
    scrollInteractionProps: {
      onScroll: handleScroll,
      onWheel: stopFollowing,
      onTouchStart: stopFollowing,
      onPointerDown: stopFollowing,
    },
  };
}
