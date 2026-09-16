const PHONE_RE = /01([0-9])[-.\s]?(\d{3,4})[-.\s]?(\d{4})/g;

/** 010-1234-5678 / 01012345678 형태를 010-****-**78 로 가린다. */
export function maskPhoneNumbers(text: string): string {
  if (typeof text !== 'string') return text;
  return text.replace(PHONE_RE, (_match, carrier: string, mid: string, last: string) =>
    `01${carrier}-${'*'.repeat(mid.length)}-**${last.slice(-2)}`);
}
