export const DIALOGUES = {
  alert_start: [
    '알빠임? 그래도 척추는 펴라.',
    '거북목 상태로 일하면 퇴근도 늦어진다.',
  ],
  stretch_start: ['시작한다. 따라와.'],
  stretch_neck_tilt: ['목 옆으로 당겨, 10초만 버텨.'],
  stretch_shoulder_roll: ['어깨 돌려라. 굳은 거 다 보인다.'],
  stretch_torso_twist: ['허리 비틀어. 삐끗하지 말고.'],
  stretch_hip_glute: ['엉덩이 좀 풀어라. 하루 종일 눌러 앉았잖아.'],
  stretch_leg_extension: ['다리 쭉 뻗어. 시원하지.'],
  stretch_spinal_twist: ['척추도 돌려줘야지.'],
  stretch_deep_breath: ['숨 크게 들이쉬고, 후.'],
  complete: ['수고했다. 다시 일해라.'],
} as const;

export type DialogueKey = keyof typeof DIALOGUES;
