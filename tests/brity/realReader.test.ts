import { describe, it, expect } from 'vitest';
import { extractCompleteLines } from '../../src/main/brity/realReader';

describe('extractCompleteLines', () => {
  it('개행이 없으면 완성된 줄이 없고 전부 나머지로 남는다', () => {
    expect(extractCompleteLines('{"a":1}')).toEqual({ lines: [], remainder: '{"a":1}' });
  });

  it('개행으로 끝나는 한 줄을 뽑아낸다', () => {
    expect(extractCompleteLines('{"a":1}\n')).toEqual({ lines: ['{"a":1}'], remainder: '' });
  });

  it('여러 줄과 미완성 나머지를 함께 처리한다', () => {
    expect(extractCompleteLines('line1\nline2\npartial')).toEqual({
      lines: ['line1', 'line2'],
      remainder: 'partial',
    });
  });

  it('빈 문자열은 완성된 줄 없이 그대로 나머지가 된다', () => {
    expect(extractCompleteLines('')).toEqual({ lines: [], remainder: '' });
  });
});
