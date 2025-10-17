export type PegaIdentifierType = 'email' | 'phone';

export interface PegaIdentifierDetectionResult {
  type: PegaIdentifierType;
  normalized: string;
  raw: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneCandidatePattern = /^[+]?\d{6,20}$/;
const phoneBasicPattern = /^[+]?\d+$/;

export const detectPegaIdentifier = (input: string): PegaIdentifierDetectionResult | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  if (emailPattern.test(lowered)) {
    return {
      type: 'email',
      normalized: lowered,
      raw: trimmed,
    };
  }

  const sanitized = trimmed.replace(/[\s()-]/g, '');
  if (!phoneBasicPattern.test(sanitized)) {
    return null;
  }

  const digits = sanitized.startsWith('+') ? sanitized.slice(1) : sanitized;
  if (!/^\d{6,20}$/.test(digits)) {
    return null;
  }

  const normalized = sanitized.startsWith('+') ? `+${digits}` : digits;
  if (phoneCandidatePattern.test(normalized)) {
    return {
      type: 'phone',
      normalized,
      raw: trimmed,
    };
  }

  return null;
};

export const maskPegaCredential = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};
