"""
브리티 메신저(BrityMessenger.exe)를 화면 접근성(UI Automation)으로 읽어
새 쪽지를 찾아내는 한 번 실행용(single-shot) 스크립트.

Electron(StretchPet) 메인 프로세스가 주기적으로(예: 20초마다) 이 스크립트를
`python reader.py --state <state.json 경로>` 형태로 실행하면,
새로 생긴 쪽지가 있을 때 그 내용을 한 줄에 JSON 하나씩 표준출력(stdout)으로
찍고 종료한다. 새 쪽지가 없으면 아무것도 찍지 않고 조용히 종료한다.

동작 원리 (직접 실행해 확인한 내용):
  0. 상태 파일이 아직 없는 최초 실행에서는, 그 순간 목록에 보이는 방/쪽지/
     채널 전부를 "기준선"으로만 저장하고 아무것도 열지 않는다 — 그렇지
     않으면 예전에 이미 다 읽은 것까지 전부 "새 것"으로 잘못 알림이 간다.
  1. [대화] "대화" 메뉴에도 "읽지 않음" 탭이 따로 있어서, 그 탭만 보면
     안 읽은 대화방만 걸러진 목록이 바로 나온다(브리티 자신이 관리하는
     안읽음 상태를 그대로 신뢰한다). 각 항목은 "방 이름+안읽음 건수+시간+
     미리보기"가 구분 기호 없이 한 문자열로 붙어서 노출된다(방 고유 ID가
     따로 없다). 항목을 더블클릭하면(한 번 클릭은 안 먹힘) 그 방 이름을
     제목으로 하는 새 창이 뜨고, 그 창의 메시지 목록(각 항목이 ListItem)
     중 마지막 항목의 이름이 최신 메시지(발신자+내용이 합쳐진 문자열)다.
  2. [쪽지] 왼쪽 메뉴의 "쪽지" 화면에는 "읽지 않음" 탭이 따로 있어서, 그
     탭만 보면 안 읽은 쪽지 목록(각 항목이 "제목, 보낸사람, 시간" 형태)이
     바로 나온다. 항목을 더블클릭하면 "쪽지"라는 별도 창이 뜨는데, 그
     안에는 제목·보낸사람·소속·받은시각이 각각 별개의 항목으로, 본문은
     하나로 합쳐진 항목으로 깔끔하게 나온다(대화보다 구조가 명확하다).
  3. [워크스페이스] 왼쪽 메뉴의 "워크스페이스" 화면에서 "채널 뷰"로
     바꾸면, 여러 워크스페이스에 흩어진 채널들이 대화방처럼 하나의 평평한
     목록으로 나온다(항목 텍스트 형태도 대화방과 비슷하게 뭉쳐 있다).
     채널을 더블클릭하면(그 채널이 속한) 워크스페이스 이름을 제목으로
     하는 새 창이 뜨는데, 메시지가 ListItem이 아니라 낱개의 Text
     요소(보낸사람·시각·본문이 각각 따로)로 나온다 — 화면에 보이는 순서로
     정렬해 맨 아래(가장 최근) 시각 형식의 텍스트를 기준으로 그 앞뒤에서
     보낸사람·본문을 찾는다.
  4. 우리가 연 창은 다 읽은 뒤 닫는다 — 사용자가 이미 열어둔 창은 건드리지
     않는다(더블클릭 전/후의 보이는 창 목록을 비교해서 새로 생긴 것만 닫음).
     쪽지·워크스페이스를 확인한 뒤에는 다음 주기의 "조용한 대화방 목록
     읽기"가 계속 되도록 화면을 다시 "대화" 메뉴로 돌려놓는다.
  5. 대화·쪽지·워크스페이스 목록을 확인하려면 매번 그 화면으로 화면을
     넘겨야 해서(포커스가 필요한 동작), 20초마다 세 곳을 전부 넘나들면
     화면이 계속 바뀌는 것처럼 보인다. 그래서 각자 정해진 간격
     (ROOM/CHANNEL_CHECK_INTERVAL_SEC, NOTE_CHECK_INTERVAL_SEC)이 지났을
     때만 그 화면을 확인한다 — 그 사이 주기에는 아예 건드리지 않는다.
     또 확인할 때 바뀐 게 여러 개면 하나하나 따로 알리지 않고, 전부 읽어서
     하나로 합친 뒤 한 번에 서버로 보낸다(자잘한 대화까지 낱개로 알림이
     오는 걸 막기 위해서).

읽기만 한다 — 답장·전달·삭제에 해당하는 코드는 전혀 없다.
"""

import argparse
import ctypes
import json
import os
import re
import sys
import time
from ctypes import wintypes
from datetime import datetime

from pywinauto import Desktop

# Node(Electron)가 이 스크립트를 자식 프로세스로 실행해 stdout을 UTF-8로 읽는다.
# Windows 콘솔의 기본 인코딩(예: 한글판의 CP949)을 따라가면 한글이 깨져서
# 넘어가므로, 표준입출력을 명시적으로 UTF-8로 고정한다.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

BRITY_PROCESS_NAME = "BrityMessenger.exe"
DOUBLE_CLICK_WAIT_SEC = 1.5
MAX_ROOMS_PER_RUN = 5  # 한 번 실행에서 너무 많은 창을 한꺼번에 열지 않도록 제한
MAX_NOTES_PER_RUN = 5
MAX_CHANNELS_PER_RUN = 5
MIN_IDLE_SEC = 30  # 이만큼 키보드·마우스 입력이 없어야 "자리 비움"으로 보고 실행한다
# 대화·워크스페이스는 자잘한 대화가 많아 20초마다 볼 필요가 없다고 판단해
# (사용자 요청) 이 간격으로만 확인한다. 쪽지는 좀 더 자주(1분) 본다.
ROOM_CHECK_INTERVAL_SEC = 120
CHANNEL_CHECK_INTERVAL_SEC = 120
NOTE_CHECK_INTERVAL_SEC = 60
NOTE_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$")
CHANNEL_TIME_RE = re.compile(r"^(\d{2}-\d{2} )?\d{2}:\d{2}$")


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


def _default_state() -> dict:
    return {
        "seenPreviews": [],
        "seenNotePreviews": [],
        "seenChannelPreviews": [],
        "lastRoomCheckAt": 0.0,
        "lastNoteCheckAt": 0.0,
        "lastChannelCheckAt": 0.0,
    }


def _load_state(path: str) -> dict:
    default = _default_state()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                result = dict(default)
                for key in ("seenPreviews", "seenNotePreviews", "seenChannelPreviews"):
                    value = data.get(key)
                    if isinstance(value, list):
                        result[key] = value
                for key in ("lastRoomCheckAt", "lastNoteCheckAt", "lastChannelCheckAt"):
                    value = data.get(key)
                    if isinstance(value, (int, float)):
                        result[key] = value
                return result
    except Exception:
        pass
    return default


def _due(state: dict, key: str, interval_sec: float, now: float) -> bool:
    """마지막으로 이 화면을 확인한 지 interval_sec 이상 지났는지."""
    last = state.get(key, 0.0)
    return (now - last) >= interval_sec


def _save_state(path: str, state: dict) -> None:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
    except Exception as e:
        print(f"[brity-reader] 상태 저장 실패: {e}", file=sys.stderr)


def _read_latest_message_from_room_window(hwnd: int) -> dict | None:
    """새로 열린 방 창(hwnd)에서 방 이름과 마지막(최신) 메시지 텍스트를 읽는다."""
    try:
        room = Desktop(backend="uia").window(handle=hwnd)
        items = room.descendants(control_type="ListItem")
        if not items:
            return None
        return {"title": room.window_text(), "body": items[-1].window_text()}
    except Exception as e:
        print(f"[brity-reader] 방 내용 읽기 실패: {e}", file=sys.stderr)
        return None


def _click_nav_button(brity_win, label: str) -> bool:
    """왼쪽 메뉴("대화", "쪽지" 등)나 탭("읽지 않음" 등)의 버튼을 이름으로 찾아 누른다.

    더블클릭과 마찬가지로, 브리티 창에 포커스가 없으면 클릭 신호가 씹히고
    아무 반응도 없다 — 그래서 클릭 전에 항상 포커스를 준다.
    """
    try:
        brity_win.set_focus()
        time.sleep(0.2)
        for ctrl_type in ("Button", "TabItem"):
            for b in brity_win.descendants(control_type=ctrl_type):
                if b.window_text() == label:
                    b.click_input()
                    return True
    except Exception as e:
        print(f"[brity-reader] '{label}' 버튼 클릭 실패: {e}", file=sys.stderr)
    return False


def _read_unread_items(brity_win, nav_labels: list, item_control_type: str, item_class_substring: str) -> dict:
    """왼쪽 메뉴를 눌러 해당 화면으로 이동한 뒤 "읽지 않음" 탭을 눌러, 안
    읽은 항목만 걸러진 목록을 읽는다. "대화"·"쪽지"·"워크스페이스"(채널 뷰)
    모두 이 "읽지 않음" 탭을 갖고 있어서 세 가지 다 같은 방식으로 다룰 수
    있다 — 대화방 목록 전체를 놓고 지난번과 통째로 비교하는 대신, 브리티
    자신이 관리하는 안읽음 상태를 그대로 신뢰하는 쪽이 더 정확하다.

    `nav_labels`는 순서대로 눌러야 하는 왼쪽 메뉴 버튼들이다 — 대화/쪽지는
    한 번("대화", "쪽지")이면 되고, 워크스페이스는 "워크스페이스"를 누른
    뒤 "채널 뷰"로 한 번 더 바꿔야 한다.
    """
    for label in nav_labels:
        if not _click_nav_button(brity_win, label):
            return {}
        time.sleep(0.5)
    _click_nav_button(brity_win, "읽지 않음")
    time.sleep(0.5)

    try:
        items = [
            b for b in brity_win.descendants(control_type=item_control_type)
            if item_class_substring in (b.element_info.class_name or "")
        ]
    except Exception as e:
        print(f"[brity-reader] '{'/'.join(nav_labels)}' 목록 읽기 실패: {e}", file=sys.stderr)
        return {}

    result = {}
    for it in items:
        try:
            result[it.window_text()] = it
        except Exception:
            continue
    return result


def _read_room_buttons(brity_win) -> dict:
    """"대화" 메뉴의 "읽지 않음" 탭에서 안 읽은 대화방 목록을 읽는다.

    항목 텍스트는 "방 이름+안읽음 건수+시간+미리보기"가 구분 기호 없이
    한 문자열로 붙어서 노출된다(방 고유 ID가 따로 없다).
    """
    return _read_unread_items(brity_win, ["대화"], "Button", "chatroomListItem")


def _read_note_buttons(brity_win) -> dict:
    """"쪽지" 메뉴의 "읽지 않음" 탭에서 안 읽은 쪽지 목록을 읽는다.

    항목 텍스트는 "제목, 보낸사람, 시간"(가끔 "첨부파일" 표시가 더 붙음) 형태다.
    """
    return _read_unread_items(brity_win, ["쪽지"], "ListItem", "dmListItem")


def _read_note_detail(hwnd: int) -> dict | None:
    """새로 열린 쪽지 창(hwnd)에서 보낸사람·받은시각·본문을 읽는다."""
    try:
        note_win = Desktop(backend="uia").window(handle=hwnd)
        text_els = [e for e in note_win.descendants(control_type="Text") if e.window_text().strip()]
        # 화면에 보이는 순서(위→아래)로 정렬해야 "제목→보낸사람→소속→받은시각" 순서를
        # 안정적으로 가정할 수 있다 (접근성 트리 순서가 항상 이 순서라는 보장이 없다).
        text_els.sort(key=lambda e: e.rectangle().top)
        texts = [e.window_text() for e in text_els if e.window_text() != "쪽지"]

        datetime_idx = next((i for i, t in enumerate(texts) if NOTE_DATETIME_RE.match(t)), None)
        subject = texts[0] if len(texts) > 0 else None
        sender = texts[1] if len(texts) > 1 else None
        received_at_text = texts[datetime_idx] if datetime_idx is not None else None

        doc_els = note_win.descendants(control_type="Document")
        body_doc = max(doc_els, key=lambda e: len(e.window_text()), default=None)
        body_text = body_doc.window_text().strip() if body_doc else None

        body_parts = [p for p in (subject, body_text) if p]
        if not body_parts:
            return None

        received_at = datetime.now().astimezone().isoformat()
        if received_at_text:
            try:
                received_at = datetime.strptime(received_at_text, "%Y-%m-%d %H:%M").astimezone().isoformat()
            except ValueError:
                pass

        return {
            "sender": sender,
            "receivedAt": received_at,
            "body": "\n\n".join(body_parts),
        }
    except Exception as e:
        print(f"[brity-reader] 쪽지 내용 읽기 실패: {e}", file=sys.stderr)
        return None


def _read_channel_buttons(brity_win) -> dict:
    """"워크스페이스" 메뉴의 "채널 뷰"로 바꾼 뒤 "읽지 않음" 탭에서 안 읽은
    채널 목록을 읽는다.

    "워크스페이스 뷰"(여러 워크스페이스를 펼쳐 채널을 찾아가는 화면)와 달리
    "채널 뷰"는 대화방 목록처럼 모든 채널을 하나의 평평한 목록으로 보여준다.
    항목 텍스트는 "채널이름 안읽음배지 시간 미리보기... 워크스페이스이름" 형태다.
    """
    return _read_unread_items(brity_win, ["워크스페이스", "채널 뷰"], "Button", "classicListItem")


def _read_latest_message_from_channel_window(hwnd: int) -> dict | None:
    """새로 열린 채널 창(hwnd)에서 마지막(최신) 메시지의 보낸사람·내용을 읽는다.

    채널 창은 대화방과 달리 메시지가 ListItem이 아니라 낱개의 Text 요소로
    나온다(보낸사람 이름, 시각, 본문이 각각 별개의 Text). 화면에 보이는
    순서(위→아래)로 정렬한 뒤, 맨 아래(가장 최근)의 "시각처럼 생긴" 텍스트를
    찾아 그 바로 앞을 보낸사람, 바로 뒤를 본문으로 본다.
    """
    try:
        channel_win = Desktop(backend="uia").window(handle=hwnd)
        text_els = [e for e in channel_win.descendants(control_type="Text") if e.window_text().strip()]
        text_els.sort(key=lambda e: e.rectangle().top)
        texts = [e.window_text() for e in text_els]

        time_indices = [i for i, t in enumerate(texts) if CHANNEL_TIME_RE.match(t)]
        if not time_indices:
            # 시각 형식을 못 찾으면 안전하게 마지막 텍스트만이라도 본문으로 쓴다.
            if not texts:
                return None
            return {"sender": None, "body": texts[-1]}

        last_time_idx = time_indices[-1]
        sender = texts[last_time_idx - 1] if last_time_idx > 0 else None
        body = texts[last_time_idx + 1] if last_time_idx + 1 < len(texts) else None
        if not body:
            return None
        return {"sender": sender, "body": body}
    except Exception as e:
        print(f"[brity-reader] 채널 내용 읽기 실패: {e}", file=sys.stderr)
        return None


def _emit_combined(parts: list) -> None:
    """여러 항목(방/쪽지/채널)에서 모은 내용을 하나로 합쳐 JSON 한 줄로 찍는다.
    낱개로 여러 번 알리는 대신, 이번에 확인한 만큼을 한 번에 정리해서 보낸다."""
    if not parts:
        return
    print(json.dumps({
        "sender": None,
        "receivedAt": datetime.now().astimezone().isoformat(),
        "body": "\n\n".join(parts),
    }, ensure_ascii=False), flush=True)


def _process_changed_rooms(brity_win, changed_buttons: list) -> set:
    """바뀐 대화방들을 순서대로 열어 마지막 메시지를 모으고, 전부 합쳐 한 번에
    찍는다. 처리에 성공한 방 텍스트의 집합을 돌려준다."""
    newly_seen = set()
    parts = []
    pid = brity_win.process_id()

    for text, room_button in changed_buttons[:MAX_ROOMS_PER_RUN]:
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
            if latest and latest.get("body"):
                parts.append(f"[대화: {latest['title']}]\n{latest['body']}")

            # 우리가 새로 연 창이니 닫는다 (사용자가 이미 열어둔 창은 건드리지 않음).
            ctypes.windll.user32.PostMessageW(room_hwnd, 0x0010, 0, 0)  # WM_CLOSE
            newly_seen.add(text)
        except Exception as e:
            print(f"[brity-reader] 방 열람 중 오류: {e}", file=sys.stderr)
            continue

    _emit_combined(parts)
    return newly_seen


def _process_changed_notes(brity_win, changed_notes: list) -> set:
    """바뀐(안 읽은) 쪽지들을 순서대로 열어 내용을 모으고, 전부 합쳐 한 번에
    찍는다. 처리에 성공한 쪽지 텍스트의 집합을 돌려준다."""
    newly_seen = set()
    parts = []
    pid = brity_win.process_id()

    for text, note_item in changed_notes[:MAX_NOTES_PER_RUN]:
        try:
            before = _visible_windows_for_pid(pid)
            note_item.double_click_input()
            time.sleep(DOUBLE_CLICK_WAIT_SEC)
            after = _visible_windows_for_pid(pid)
            new_handles = after - before
            if not new_handles:
                continue  # 못 열었으면 다음 주기에 다시 시도한다 (seen 처리 안 함)
            note_hwnd = next(iter(new_handles))

            detail = _read_note_detail(note_hwnd)
            if detail and detail.get("body"):
                sender = detail.get("sender") or "알 수 없음"
                parts.append(f"[쪽지 - 보낸사람: {sender}]\n{detail['body']}")

            ctypes.windll.user32.PostMessageW(note_hwnd, 0x0010, 0, 0)  # WM_CLOSE
            newly_seen.add(text)
        except Exception as e:
            print(f"[brity-reader] 쪽지 열람 중 오류: {e}", file=sys.stderr)
            continue

    _emit_combined(parts)
    return newly_seen


def _process_changed_channels(brity_win, changed_channels: list) -> set:
    """바뀐(새 소식이 있는) 워크스페이스 채널들을 순서대로 열어 최신 메시지를
    모으고, 전부 합쳐 한 번에 찍는다. 처리에 성공한 채널 텍스트의 집합을
    돌려준다."""
    newly_seen = set()
    parts = []
    pid = brity_win.process_id()

    for text, channel_button in changed_channels[:MAX_CHANNELS_PER_RUN]:
        try:
            before = _visible_windows_for_pid(pid)
            channel_button.double_click_input()
            time.sleep(DOUBLE_CLICK_WAIT_SEC)
            after = _visible_windows_for_pid(pid)
            new_handles = after - before
            if not new_handles:
                continue  # 못 열었으면 다음 주기에 다시 시도한다 (seen 처리 안 함)
            channel_hwnd = next(iter(new_handles))

            latest = _read_latest_message_from_channel_window(channel_hwnd)
            if latest and latest.get("body"):
                sender = latest.get("sender") or "알 수 없음"
                # text(채널 목록 항목의 원본 표시 문자열)에 채널 이름과 소속
                # 워크스페이스가 이미 섞여 있어 그대로 라벨로 쓴다 — 열린 창의
                # 제목은 채널이 아니라 워크스페이스 이름이라 정확하지 않다.
                parts.append(f"[워크스페이스: {text} / 보낸사람: {sender}]\n{latest['body']}")

            # 우리가 새로 연 창이니 닫는다 (사용자가 이미 열어둔 창은 건드리지 않음).
            ctypes.windll.user32.PostMessageW(channel_hwnd, 0x0010, 0, 0)  # WM_CLOSE
            newly_seen.add(text)
        except Exception as e:
            print(f"[brity-reader] 채널 열람 중 오류: {e}", file=sys.stderr)
            continue

    _emit_combined(parts)
    return newly_seen


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

    # 이 컴퓨터에서 이 기능을 켠 게 이번이 처음인지(상태 파일이 아직 없는지)
    # 먼저 기록해 둔다 — 최초 실행 때는 그 순간 목록에 있는 모든 방/쪽지(이미
    # 예전에 다 읽은 것도 포함)를 전부 "새로 생김"으로 잘못 판단해서, 오래된
    # 내용을 "새 것"이라며 열어보는 문제가 있었다. 최초 실행일 때는 지금
    # 보이는 목록을 "기준선"으로만 저장하고, 방/쪽지는 하나도 열지 않는다.
    is_first_run = not os.path.exists(args.state)

    state = _load_state(args.state)
    previously_seen_rooms = set(state["seenPreviews"])
    previously_seen_notes = set(state["seenNotePreviews"])
    previously_seen_channels = set(state["seenChannelPreviews"])

    # 방/쪽지/채널 목록 읽기 전부 "읽지 않음" 탭으로 화면을 바꿔야 해서
    # (포커스가 필요한 동작이다) 이제는 조용히 읽을 방법이 없다 — 그래서
    # 목록을 읽기도 전에 먼저 자리 비움부터 확인한다. 최초 실행(바로
    # 아래)만 예외로, 방을 열지는 않고 목록만 확인하는 것이므로 자리 비움과
    # 무관하게 바로 기준선을 잡는다(사용자가 방금 기능을 켰을 테니 이 정도
    # 화면 전환은 자연스럽다).
    if is_first_run:
        current_rooms_by_text = _read_room_buttons(brity_win)
        note_buttons = _read_note_buttons(brity_win)
        channel_buttons = _read_channel_buttons(brity_win)
        _click_nav_button(brity_win, "대화")
        now = time.time()
        _save_state(args.state, {
            "seenPreviews": sorted(current_rooms_by_text.keys()),
            "seenNotePreviews": sorted(note_buttons.keys()),
            "seenChannelPreviews": sorted(channel_buttons.keys()),
            "lastRoomCheckAt": now,
            "lastNoteCheckAt": now,
            "lastChannelCheckAt": now,
        })
        return 0

    if _idle_seconds() < MIN_IDLE_SEC:
        # 선생님이 지금 다른 걸 쓰고 계시면 이번 주기는 건너뛴다 — 화면이
        # 브리티로 튀는 걸 피하기 위해서다. 다음 주기에(자리를 비우면) 다시
        # 시도하도록, 상태는 저장하지 않고 그대로 끝낸다.
        return 0

    now = time.time()
    check_rooms = _due(state, "lastRoomCheckAt", ROOM_CHECK_INTERVAL_SEC, now)
    check_notes = _due(state, "lastNoteCheckAt", NOTE_CHECK_INTERVAL_SEC, now)
    check_channels = _due(state, "lastChannelCheckAt", CHANNEL_CHECK_INTERVAL_SEC, now)
    if not (check_rooms or check_notes or check_channels):
        # 세 화면 다 아직 확인할 때가 안 됐으면, 화면을 전혀 건드리지 않고
        # 조용히 끝낸다 — 이게 "불필요하게 화면을 계속 넘기지 않는다"의 핵심이다.
        return 0

    # 더블클릭/메뉴 전환이 실제로 먹히려면 브리티 창에 포커스를 준 뒤여야
    # 한다 (포커스 없이 보내면 클릭 신호가 씹히고 아무 반응도 없다 — 실제로
    # 겪은 문제라서 반드시 필요하다).
    try:
        brity_win.set_focus()
        time.sleep(0.3)
    except Exception as e:
        print(f"[brity-reader] 포커스 설정 실패: {e}", file=sys.stderr)
        return 0

    # 이번 주기에 확인하지 않은 화면은 이전 seen 목록을 그대로 들고 간다 —
    # 확인 안 한 걸 빈 목록과 비교해버리면 다음번에 전부 "바뀐 것"으로
    # 잘못 잡히기 때문이다.
    rooms_seen_next = previously_seen_rooms
    notes_seen_next = previously_seen_notes
    channels_seen_next = previously_seen_channels
    last_room_check_at = state["lastRoomCheckAt"]
    last_note_check_at = state["lastNoteCheckAt"]
    last_channel_check_at = state["lastChannelCheckAt"]

    if check_rooms:
        current_rooms_by_text = _read_room_buttons(brity_win)
        changed_rooms = [
            (text, b) for text, b in current_rooms_by_text.items() if text not in previously_seen_rooms
        ]
        newly_seen_rooms = _process_changed_rooms(brity_win, changed_rooms)
        unchanged_rooms = previously_seen_rooms & set(current_rooms_by_text.keys())
        rooms_seen_next = unchanged_rooms | newly_seen_rooms
        last_room_check_at = now

    if check_notes:
        current_notes_by_text = _read_note_buttons(brity_win)
        changed_notes = [
            (text, b) for text, b in current_notes_by_text.items() if text not in previously_seen_notes
        ]
        newly_seen_notes = _process_changed_notes(brity_win, changed_notes)
        unchanged_notes = previously_seen_notes & set(current_notes_by_text.keys())
        notes_seen_next = unchanged_notes | newly_seen_notes
        last_note_check_at = now

    if check_channels:
        current_channels_by_text = _read_channel_buttons(brity_win)
        changed_channels = [
            (text, b) for text, b in current_channels_by_text.items() if text not in previously_seen_channels
        ]
        newly_seen_channels = _process_changed_channels(brity_win, changed_channels)
        unchanged_channels = previously_seen_channels & set(current_channels_by_text.keys())
        channels_seen_next = unchanged_channels | newly_seen_channels
        last_channel_check_at = now

    # 다음 주기의 "조용한 대화방 목록 읽기"가 계속 되도록 화면을 "대화"로
    # 되돌려놓는다 (쪽지·워크스페이스를 확인하느라 화면을 옮겨뒀을 수 있어서).
    _click_nav_button(brity_win, "대화")

    _save_state(args.state, {
        "seenPreviews": sorted(rooms_seen_next),
        "seenNotePreviews": sorted(notes_seen_next),
        "seenChannelPreviews": sorted(channels_seen_next),
        "lastRoomCheckAt": last_room_check_at,
        "lastNoteCheckAt": last_note_check_at,
        "lastChannelCheckAt": last_channel_check_at,
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
