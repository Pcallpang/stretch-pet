# 캐릭터 고정하기(Pin) 기능 설계

## 배경
사용자가 오른쪽 클릭으로 캐릭터를 화면에 고정해, 배회(랜덤 좌우 이동)를 멈추고 싶어함.
현재 오른쪽 클릭은 컨텍스트 메뉴(지금 스트레칭 하기 / 스트레칭 시간 설정 / 종료)를 여는 데
쓰이고 있음.

## 결정 사항
- 우클릭 자체를 바꾸지 않고, 기존 컨텍스트 메뉴에 체크박스 항목 `고정하기`를 추가한다.
- 고정 시 멈추는 것은 화면 배회(walk 상태로의 자동 전환)뿐이다. 드래그 이동은 계속 가능하다.
- 고정 상태는 `settings.ts`(electron-store)에 저장되어 프로그램 재시작 후에도 유지된다.

## 변경 범위
1. **src/main/settings.ts**
   - `PetSettings`에 `pinned: boolean` 추가 (기본값 `false`).
   - `clampSettings`에 `pinned` boolean 검증 추가.
2. **src/main/main.ts**
   - `show-pet-context-menu` 핸들러의 메뉴 템플릿에 `type: 'checkbox'` 항목 `고정하기` 추가.
     `checked: getSettings().pinned`, 클릭 시 `setSettings({ pinned: menuItem.checked })` 후
     렌더러로 `pinned-changed` 이벤트(`mainWindow.webContents.send('pinned-changed', checked)`) 전송.
3. **src/main/preload.ts / src/types/global.d.ts**
   - `onPinnedChanged(callback: (pinned: boolean) => void)` 노출.
4. **src/renderer/renderer.ts**
   - 모듈 스코프 `let pinned = false;` 추가.
   - 시작 시 `window.petAPI.getSettings()`로 초기값 읽어 반영.
   - 배회 트리거 `setInterval(() => { if (isDragging || !settingsPanelEl...) return; if (state==='idle') fire('wander_start'); ... }, 8000)`
     조건에 `pinned` 추가해 고정 중엔 `wander_start`가 발화하지 않게 함.
   - `onPinnedChanged` 콜백에서 `pinned` 값을 갱신하고, 고정을 켜는 순간 `state === 'walk'`이면
     즉시 `fire('wander_pause')`로 걷기를 멈춘다.

## 테스트
- `tests/settings.test.ts`에 `clampSettings`의 `pinned` 필드 케이스(boolean 통과, 비boolean이면
  기본값 false) 추가.

## 범위 밖
- 드래그 잠금, 다중 모니터별 고정 위치 기억, 트레이 메뉴 동기화는 이번 범위에 포함하지 않음
  (요청 범위는 배회 정지만).
