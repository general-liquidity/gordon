import { useState, useRef, useCallback, useEffect } from "react";

// ============================================================================
// useVoiceInput — React hook wrapping the VoiceInputService
// ============================================================================

import { VoiceInputService, type VoiceConfig } from "../services/voiceInput.js";

interface UseVoiceInputResult {
  isRecording: boolean;
  isAvailable: boolean;
  lastTranscript: string;
  startRecording: () => void;
  stopAndTranscribe: () => Promise<string>;
}

export function useVoiceInput(config?: Partial<VoiceConfig>): UseVoiceInputResult {
  const serviceRef = useRef<VoiceInputService | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");

  // Initialise service once
  useEffect(() => {
    const svc = new VoiceInputService(config);
    serviceRef.current = svc;
    setIsAvailable(svc.isAvailable());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startRecording = useCallback(() => {
    const svc = serviceRef.current;
    if (!svc || !svc.isAvailable()) return;
    svc.startRecording();
    setIsRecording(true);
  }, []);

  const stopAndTranscribe = useCallback(async (): Promise<string> => {
    const svc = serviceRef.current;
    if (!svc || !svc.isRecording()) return "";

    try {
      const text = await svc.stopRecording();
      setLastTranscript(text);
      setIsRecording(false);
      return text;
    } catch {
      setIsRecording(false);
      return "";
    }
  }, []);

  return { isRecording, isAvailable, lastTranscript, startRecording, stopAndTranscribe };
}
