"""
브리티 메신저(BrityMessenger.exe)를 화면 접근성(UI Automation)으로 읽어
새 쪽지를 찾아내는 한 번 실행용(single-shot) 스크립트.

Electron(StretchPet) 메인 프로세스가 주기적으로(예: 20초마다) 이 스크립트를
`python reader.py --state <state.json 경로>` 형태로 실행하면,
새로 생긴 쪽지가 있을 때 그 내용을 한 줄에 JSON 하나씩 표준출력(stdout)으로
찍고 종료한다. 새 쪽지가 없으면 아무것도 찍지 않고 조용히 종료한다.

동작 원리 (직접 실행해 확인한 내용):
  1. 브리티 대화방 목록의 각 항목은 "방 이름+안읽음 건수+시간+미리보기"가
     구분 기호 없이 한 문자열로 붙어서 노출된다. 방 고유 ID가 따로 없어서,
     이 문자열 전체가 지난번과 다르면 "새 소식이 있다"고 판단한다.
  2. 새 소식이 있는 방 항목을 더블클릭하면(한 번 클릭은 안 먹힘) 그 방
     이름을 제목으로 하는 새 창이 뜬다.
  3. 그 창의 메시지 목록(각 항목이 ListItem) 중 마지막 항목의 이름이
     최신 메시지(발신자+내용이 합쳐진 문자열)다.
  4. 우리가 연 창은 다 읽은 뒤 닫는다 — 사용자가 이미 열어둔 창은 건드리지
     않는다(더블클릭 전/후의 보이는 창 목록을 비교해서 새로 생긴 것만 닫음).

읽기만 한다 — 답장·전달·삭제에 해당하는 코드는 전혀 없다.
"""

import argparse
import ctypes
import json
import sys
import time
from ctypes import wintypes

from pywinauto import Desktop

# Node(Electron)가 이 스크립트를 자식 프로세스로 실행해 stdout을 UTF-8로 읽는다.
# Windows 콘솔의 기본 인코딩(예: 한글판의 CP949)을 따라가면 한글이 깨져서
# 넘어가므로, 표준입출력을 명시적으로 UTF-8로 고정한다.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

BRITY_PROCESS_NAME = "BrityMessenger.exe"
DOUBLE_CLICK_WAIT_SEC = 1.5
MAX_ROOMS_PER_RUN = 5  # 한 번 실행에서 너무 많은 창을 한꺼번에 열지 않도록 제한
MIN_IDLE_SEC = 30  # 이만큼 키보드·마우스 입력이 없어야 "자리 비움"으로 보고 실행한다


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def _idle_seconds() -> float:
    """마지막 키보드·마우스 입력 이후 지난 시간(초). 실패하면 0(=항상 실행)을 준다."""
    try:
        info = LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(LASTINPUTINFO)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
            return 0.0
        millis_since_boot = ctypes.windll.kernel32.GetTickCount()
        return max(0.0, (millis_since_boot - info.dwTime) / 1000.0)
    except Exception:
        return 0.0


def _find_brity_main_window():
    """브리티 대화방 목록 창(HWND)을 찾는다. 못 찾으면 None."""
    try:
        wins = Desktop(backend="uia").windows(title="Brity Messenger", top_level_only=True)
    except Exception:
        return None
    for w in wins:
        try:
            if w.element_info.class_name == "Chrome_WidgetWin_1":
                return w
        except Exception:
            continue
    return None


def _is_brity_focused(brity_win) -> bool:
    """사용자가 지금 브리티를 실제로 쓰고 있는 중인지(포커스 여부)."""
    try:
        fg = ctypes.windll.user32.GetForegroundWindow()
        return fg == brity_win.handle
    except Exception:
        return False


def _visible_windows_for_pid(pid: int) -> set:
    result = set()

    EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def callback(hwnd, _lparam):
        wpid = wintypes.DWORD()
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        if wpid.value == pid and ctypes.windll.user32.IsWindowVisible(hwnd):
            result.add(hwnd)
        return True

    ctypes.windll.user32.EnumWindows(EnumWindowsProc(callback), 0)
    return result


def _load_state(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("seenPreviews"), list):
                return {"seenPreviews": data["seenPreviews"]}
    except Exception:
        pass
    return {"seenPreviews": []}


def _save_state(path: str, state: dict) -> None:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
    except Exception as e:
        print(f"[brity-reader] 상태 저장 실패: {e}", file=sys.stderr)


def _read_latest_message_from_room_window(hwnd: int) -> str | None:
    """새로 열린 방 창(hwnd)에서 마지막(최신) 메시지의 텍스트를 읽는다."""
    try:
        room = Desktop(backend="uia").window(handle=hwnd)
        items = room.descendants(control_type="ListItem")
        if not items:
            return None
        return items[-1].window_text()
    except Exception as e:
        print(f"[brity-reader] 방 내용 읽기 실패: {e}", file=sys.stderr)
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", required=True, help="이전에 본 미리보기 목록을 저장해 둘 JSON 파일 경로")
    args = parser.parse_args()

    brity_win = _find_brity_main_window()
    if brity_win is None:
        # 브리티가 안 켜져 있으면 조용히 종료 (에러 아님)
        return 0

    if _is_brity_focused(brity_win):
        # 사용자가 지금 브리티를 쓰고 있으면 방해하지 않는다.
        return 0

    state = _load_state(args.state)
    previously_seen = set(state["seenPreviews"])

    # 목록 읽기 자체는 포커스가 없어도 된다 — 방을 여는 동작(더블클릭)만
    # 포커스가 필요하다. 그래서 "무엇이 바뀌었나" 확인은 항상 조용히 하고,
    # 실제로 방을 여는 건 아래에서 자리 비움일 때만 한다.
    try:
        room_buttons = [
            b for b in brity_win.descendants(control_type="Button")
            if "chatroomListItem" in (b.element_info.class_name or "")
        ]
    except Exception as e:
        print(f"[brity-reader] 방 목록 읽기 실패: {e}", file=sys.stderr)
        return 0

    current_by_text = {}
    changed_buttons = []
    for b in room_buttons:
        try:
            text = b.window_text()
        except Exception:
            continue
        current_by_text[text] = b
        if text not in previously_seen:
            changed_buttons.append((text, b))

    if not changed_buttons:
        return 0  # 바뀐 게 없으면 여기서 끝 — 창 하나도 안 건드림

    if _idle_seconds() < MIN_IDLE_SEC:
        # 바뀐 방이 있어도, 선생님이 지금 다른 걸 쓰고 계시면 이번 주기는
        # 건너뛴다 — 화면이 브리티로 튀는 걸 피하기 위해서다. 다음 주기에
        # (자리를 비우면) 다시 시도하도록, 상태는 저장하지 않고 그대로 끝낸다.
        return 0

    # 더블클릭이 실제로 먹히려면 브리티 창에 포커스를 준 뒤여야 한다
    # (포커스 없이 보내면 클릭 신호가 씹히고 아무 반응도 없다 — 실제로
    # 겪은 문제라서 반드시 필요하다).
    try:
        brity_win.set_focus()
        time.sleep(0.3)
    except Exception as e:
        print(f"[brity-reader] 포커스 설정 실패: {e}", file=sys.stderr)
        return 0

    changed_buttons = changed_buttons[:MAX_ROOMS_PER_RUN]
    newly_seen = set()
    pid = brity_win.process_id()

    for text, room_button in changed_buttons:
        try:
            before = _visible_windows_for_pid(pid)
            room_button.double_click_input()
            time.sleep(DOUBLE_CLICK_WAIT_SEC)
            after = _visible_windows_for_pid(pid)
            new_handles = after - before
            if not new_handles:
                continue  # 못 열었으면 이번 방은 다음 주기에 다시 시도한다 (seen 처리 안 함)
            room_hwnd = next(iter(new_handles))

            latest = _read_latest_message_from_room_window(room_hwnd)
            if latest:
                print(json.dumps({
                    "sender": None,
                    "receivedAt": __import__("datetime").datetime.now().astimezone().isoformat(),
                    "body": latest,
                }, ensure_ascii=False), flush=True)

            # 우리가 새로 연 창이니 닫는다 (사용자가 이미 열어둔 창은 건드리지 않음).
            ctypes.windll.user32.PostMessageW(room_hwnd, 0x0010, 0, 0)  # WM_CLOSE
            newly_seen.add(text)
        except Exception as e:
            print(f"[brity-reader] 방 열람 중 오류: {e}", file=sys.stderr)
            continue

    # 이번에 처리하지 못한(용량 초과로 건너뛴, 또는 열기 실패한) 바뀐 방은
    # previously_seen에 남겨두지 않는다 — 즉 다음 주기에 다시 "바뀐 방"으로
    # 잡혀서 재시도된다. 처리에 성공한 방과, 애초에 안 바뀐 방만 저장한다.
    unchanged = previously_seen & set(current_by_text.keys())
    _save_state(args.state, {"seenPreviews": sorted(unchanged | newly_seen)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
