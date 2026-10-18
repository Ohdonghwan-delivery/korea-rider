
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';

import { WebView } from 'react-native-webview';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as XLSX from 'xlsx';
import { EXCEL_BRIDGE_HTML } from './excelBridgeHtml';
import { RIDER_MAP_HTML } from './riderMapHtml';

// ==========================================
// 고려딜리버리 RIDER CONTROL v1.6.0
// ==========================================

const HOME = 'https://deliverycenter.baemin.com/';

const HISTORY =
  'https://deliverycenter.baemin.com/delivery/history';

const FEES =
  'https://deliverycenter.baemin.com/center/delivery-fee-download';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PASSWORD_KEY = 'kd_baemin_excel_password_v1';
const AUTO_KEY = 'kd_baemin_excel_auto_v1';

// 기존 기사 GPS 프로젝트와 동일한 Supabase 프로젝트.
// 이 키는 공개(publishable) 키이며 관리자 권한을 대신하지 않습니다.
const GPS_SUPABASE_URL = 'https://zkfhemhngrtwgwmtinuz.supabase.co';
const GPS_SUPABASE_KEY = 'sb_publishable_ghp_TLSYEgHwjRcTm3nFUQ_ggFyMLWu';
const GPS_POLL_MS = 5000;
const GPS_LIVE_MS = 60000;

function gpsIsLive(r) {
  if (r.is_sharing !== true) return false;
  if (r.latitude === null || r.longitude === null) return false;
  const lat = Number(r.latitude);
  const lng = Number(r.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return false;
  const ts = Date.parse(r.last_seen_at || '');
  const elapsed = Date.now() - ts;
  return Number.isFinite(elapsed) && elapsed >= -10000 && elapsed <= GPS_LIVE_MS;
}


function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function validDate(s) {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());

  if (!m) return false;

  const d = new Date(+m[1], +m[2] - 1, +m[3]);

  return (
    d.getFullYear() === +m[1] &&
    d.getMonth() === +m[2] - 1 &&
    d.getDate() === +m[3]
  );
}

function num(value) {
  return (
    Number(
      String(value ?? '').replace(/[^\d.-]/g, '')
    ) || 0
  );
}

function money(value) {
  return (
    Math.round(Number(value) || 0)
      .toLocaleString('ko-KR') + '원'
  );
}

function isExcelBase64(base64) {
  return (
    base64.startsWith('UEs') ||
    base64.startsWith('0M8R4K')
  );
}

// ==========================================
// 배민 기사 현황 자동 수집
// ==========================================

const MONITOR_JS = String.raw`
(function () {
  if (window.__kdMonitorInstalled) return true;
  window.__kdMonitorInstalled = true;

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  const norm = value =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

  const flat = value =>
    norm(value)
      .replace(/\s+/g, '')
      .replace(/[()]/g, '');

  let busy = false;

  function send(data) {
    try {
      window.ReactNativeWebView.postMessage(
        JSON.stringify(data)
      );
    } catch (e) {}
  }

  function findTable() {
    return Array.from(
      document.querySelectorAll('table')
    ).find(table => {
      const headers = Array.from(
        table.querySelectorAll('thead th')
      ).map(th => norm(th.innerText));

      return (
        headers.some(h => h.includes('이름')) &&
        headers.some(h => h.includes('운행상태'))
      );
    });
  }

  function readPage() {
    const table = findTable();
    if (!table) return null;

    const headerRows = Array.from(
      table.querySelectorAll('thead tr')
    ).slice(0, 2);

    const matrix = [];

    headerRows.forEach((tr, r) => {
      matrix[r] ||= [];
      let c = 0;

      Array.from(tr.children).forEach(th => {
        if (!/^(TH|TD)$/.test(th.tagName)) return;

        while (matrix[r][c] !== undefined) c++;

        const cs = Math.max(
          1,
          Number(th.getAttribute('colspan')) || 1
        );

        const rs = Math.max(
          1,
          Number(th.getAttribute('rowspan')) || 1
        );

        const label = norm(th.innerText);

        for (let y = r; y < r + rs; y++) {
          matrix[y] ||= [];

          for (let x = c; x < c + cs; x++) {
            matrix[y][x] = label;
          }
        }

        c += cs;
      });
    });

    const width = Math.max(
      0,
      ...matrix.map(row => row.length)
    );

    const paths = Array.from(
      { length: width },
      (_, c) =>
        matrix
          .map(row => norm(row[c]))
          .filter(
            (v, i, a) =>
              v && (i === 0 || v !== a[i - 1])
          )
    );

    const exact = label =>
      paths.findIndex(path =>
        path.some(x => flat(x) === flat(label))
      );

    function groupTotal(group) {
      const hits = [];

      paths.forEach((path, index) => {
        if (
          path.length >= 2 &&
          flat(path[0]) === flat(group) &&
          flat(path[path.length - 1]) === '합계'
        ) {
          hits.push(index);
        }
      });

      return hits.length === 1 ? hits[0] : -1;
    }

    const idx = {
      name: exact('이름'),
      status: exact('운행상태'),
      completed: exact('총 배달완료'),
      rejected: groupTotal('SLA 거절'),
      canceled: groupTotal('SLA 배차취소'),
      riderFault: groupTotal(
        'SLA 배달취소 (라이더 귀책)'
      ),
    };

    if (idx.name < 0 || idx.status < 0) {
      return null;
    }

    const rows = Array.from(
      table.querySelectorAll('tbody tr')
    )
      .map(tr => {
        const cells = Array.from(
          tr.querySelectorAll('td')
        ).map(td => norm(td.innerText));

        const get = index =>
          index >= 0 ? cells[index] || '' : '';

        const name = get(idx.name);

        if (
          !name ||
          ['합계', '총합계', '전체'].includes(name)
        ) {
          return null;
        }

        const count = index => {
          if (index < 0) return null;

          const match = get(index)
            .replace(/,/g, '')
            .match(/-?\d+/);

          return match ? Number(match[0]) : null;
        };

        return {
          name,
          status: get(idx.status),
          completed: count(idx.completed),
          rejected: count(idx.rejected),
          canceled: count(idx.canceled),
          riderFault: count(idx.riderFault),
        };
      })
      .filter(Boolean);

    return { rows, columns: idx };
  }

  function pageButton(n) {
    return Array.from(
      document.querySelectorAll(
        'button,a,[role="button"]'
      )
    ).find(el =>
      norm(el.innerText) === String(n) &&
      el.getClientRects().length > 0
    );
  }

  function signature() {
    const table = findTable();

    return norm(
      table &&
      table.querySelector('tbody')?.innerText
    );
  }

  async function switchPage(n) {
    const button = pageButton(n);

    if (!button) return false;

    const before = signature();
    button.click();

    for (let i = 0; i < 25; i++) {
      await sleep(120);

      const after = signature();

      if (after && after !== before) {
        return true;
      }
    }

    return false;
  }

  async function poll() {
    if (
      busy ||
      !location.pathname.includes('/delivery/history')
    ) {
      return;
    }

    busy = true;

    try {
      const first = readPage();

      if (!first) {
        send({
          type: 'monitor-error',
          message: '기사 현황 표를 찾지 못했습니다.',
        });
        return;
      }

      let rows = first.rows.slice();
      const p2 = pageButton(2);
      let secondOk = false;

      if (p2) {
        if (
          p2.getAttribute('aria-current') !== 'page'
        ) {
          secondOk = await switchPage(2);

          if (secondOk) {
            const second = readPage();

            if (second) {
              rows = rows.concat(second.rows);
            }
          }

          await switchPage(1);
        } else {
          secondOk = true;
        }
      }

      const byName = new Map();

      rows.forEach(row =>
        byName.set(row.name, row)
      );

      const unique = Array.from(
        byName.values()
      );

      const complete = !p2 || secondOk;

      function sum(key) {
        if (
          !complete ||
          first.columns[key] < 0
        ) {
          return null;
        }

        const values = unique.map(
          row => row[key]
        );

        if (
          values.some(value => value === null)
        ) {
          return null;
        }

        return values.reduce(
          (a, b) => a + b,
          0
        );
      }

      send({
        type: 'summary',
        at: new Date().toISOString(),
        summary: {
          total: complete
            ? unique.length
            : null,

          active: complete
            ? unique.filter(row =>
                /운행중|배달중|수행중/.test(
                  row.status
                )
              ).length
            : null,

          completed: sum('completed'),
          rejected: sum('rejected'),
          canceled: sum('canceled'),
          riderFault: sum('riderFault'),
        },

        diagnostic: {
          collected: unique.length,
          page2: !!p2,
          secondOk,
        },
      });
    } catch (e) {
      send({
        type: 'monitor-error',
        message: String(e.message || e),
      });
    } finally {
      busy = false;
    }
  }

  send({ type: 'bridge-ready' });

  poll();

  window.__kdMonitorTimer =
    setInterval(poll, 5000);
})();
true;
`;

// ==========================================
// 배민 날짜 선택 및 엑셀 다운로드
// ==========================================

function buildFeeScript(dateString, reasonText) {
  const target = JSON.stringify(dateString);

  const reason = JSON.stringify(
    String(reasonText || '정산용').slice(0, 40)
  );

  return String.raw`
(function () {
  if (window.__kdFeeBusy) return true;

  window.__kdFeeBusy = true;

  const target = ${target};
  const reason = ${reason};

  const [year, month, day] =
    target.split('-').map(Number);

  const sleep = ms =>
    new Promise(r => setTimeout(r, ms));

  const visible = el =>
    !!el && el.getClientRects().length > 0;

  const norm = value =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

  function post(data) {
    window.ReactNativeWebView.postMessage(
      JSON.stringify(data)
    );
  }

  function send(message, success, stage) {
    post({
      type: 'fee-date',
      target,
      message,
      success: !!success,
      stage: stage || '',
    });
  }

  async function waitFor(
    fn,
    label,
    timeout = 8000
  ) {
    const start = Date.now();

    while (
      Date.now() - start < timeout
    ) {
      const result = fn();

      if (result) return result;

      await sleep(150);
    }

    throw new Error(
      label + ' 찾기 실패'
    );
  }

  const trigger = () =>
    Array.from(
      document.querySelectorAll(
        'button[data-atelier-component="DatePicker.Trigger"]'
      )
    ).find(visible);

  const days = () =>
    Array.from(
      document.querySelectorAll(
        'button[aria-label$="일"]'
      )
    ).filter(visible);

  const dayButton = () =>
    days().find(el =>
      el.getAttribute('aria-label') ===
        day + '일' &&
      el.getAttribute('aria-disabled') !==
        'true' &&
      !el.disabled
    );

  const action = name =>
    Array.from(
      document.querySelectorAll(
        'button[data-atelier-component="Button"]'
      )
    ).find(el =>
      visible(el) &&
      norm(el.textContent) === name &&
      el.getAttribute('aria-disabled') !==
        'true' &&
      el.getAttribute('data-disabled') !==
        'true' &&
      !el.disabled
    );

  const expected =
    year + '. ' +
    String(month).padStart(2, '0') +
    '. ' +
    String(day).padStart(2, '0');

  const dateVerified = () => {
    const text = norm(
      trigger()?.innerText
    );

    return (
      text.includes(expected) &&
      !/[~～]/.test(text)
    );
  };

  async function ensureCalendar() {
    if (days().length > 0) return;

    const button = await waitFor(
      trigger,
      '달력 열기 버튼'
    );

    button.click();

    await waitFor(
      () => days().length > 0,
      '달력 날짜 버튼'
    );
  }

  function installDownloadCapture() {
    if (
      window.__kdXhrCaptureInstalled
    ) {
      return;
    }

    window.__kdXhrCaptureInstalled = true;

    const originalOpen =
      XMLHttpRequest.prototype.open;

    const originalSend =
      XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open =
      function(method, url) {
        this.__kdFeeUrl = String(
          url || ''
        );

        return originalOpen.apply(
          this,
          arguments
        );
      };

    XMLHttpRequest.prototype.send =
      function() {
        if (
          this.__kdFeeUrl &&
          this.__kdFeeUrl.includes(
            '/v2/management/delivery-fee?'
          )
        ) {
          this.addEventListener(
            'loadend',
            async () => {
              try {
                if (this.status !== 200) {
                  throw new Error(
                    'HTTP ' + this.status
                  );
                }

                const parsed = new URL(
                  this.responseURL ||
                    this.__kdFeeUrl,
                  location.href
                );

                const from =
                  parsed.searchParams.get(
                    'fromDate'
                  );

                const to =
                  parsed.searchParams.get(
                    'toDate'
                  );

                if (
                  from !== target ||
                  to !== target
                ) {
                  throw new Error(
                    '다운로드 날짜 불일치: ' +
                    from + ' ~ ' + to
                  );
                }

                const contentType =
                  this.getResponseHeader(
                    'content-type'
                  ) || '';

                if (
                  !/spreadsheet|octet-stream|zip/i.test(
                    contentType
                  )
                ) {
                  throw new Error(
                    '엑셀 응답이 아닙니다: ' +
                    contentType
                  );
                }

                let blob;

                if (
                  this.response instanceof Blob
                ) {
                  blob = this.response;
                } else if (
                  this.response instanceof ArrayBuffer
                ) {
                  blob = new Blob([
                    this.response,
                  ]);
                } else if (
                  ArrayBuffer.isView(
                    this.response
                  )
                ) {
                  blob = new Blob([
                    this.response,
                  ]);
                } else {
                  throw new Error(
                    'XHR 응답 형식 지원 안 됨: ' +
                    this.responseType
                  );
                }

                if (
                  !blob.size ||
                  blob.size >
                    15 * 1024 * 1024
                ) {
                  throw new Error(
                    '파일 크기 오류: ' +
                    blob.size
                  );
                }

                const reader =
                  new FileReader();

                reader.onerror = () =>
                  send(
                    '파일 변환 실패',
                    false,
                    'error'
                  );

                reader.onload = () => {
                  const base64 =
                    String(reader.result)
                      .split(',')[1] || '';

                  if (
                    !base64.startsWith('UEs') &&
                    !base64.startsWith(
                      '0M8R4K'
                    )
                  ) {
                    send(
                      '지원되지 않는 엑셀 형식',
                      false,
                      'error'
                    );
                    return;
                  }

                  const chunkSize = 32000;

                  const total = Math.ceil(
                    base64.length /
                      chunkSize
                  );

                  const id =
                    target + '-' +
                    Date.now();

                  post({
                    type: 'fee-file-start',
                    id,
                    target,
                    total,
                    bytes: blob.size,
                  });

                  for (
                    let i = 0;
                    i < total;
                    i++
                  ) {
                    post({
                      type: 'fee-file-chunk',
                      id,
                      index: i,
                      data: base64.slice(
                        i * chunkSize,
                        (i + 1) *
                          chunkSize
                      ),
                    });
                  }

                  post({
                    type: 'fee-file-end',
                    id,
                  });
                };

                reader.readAsDataURL(
                  blob
                );
              } catch (err) {
                send(
                  '엑셀 수신 실패: ' +
                    String(
                      err.message || err
                    ),
                  false,
                  'error'
                );
              }
            },
            { once: true }
          );
        }

        return originalSend.apply(
          this,
          arguments
        );
      };
  }

  async function run() {
    if (
      !location.pathname.includes(
        '/center/delivery-fee-download'
      )
    ) {
      throw new Error(
        '배민 정산 페이지가 아닙니다.'
      );
    }

    await waitFor(
      trigger,
      '날짜 선택 버튼',
      15000
    );

    if (!dateVerified()) {
      send(
        '달력에서 날짜 선택 중...',
        false,
        'selecting'
      );

      await ensureCalendar();

      const reset = await waitFor(
        () => action('초기화'),
        '초기화 버튼'
      );

      reset.click();

      await sleep(300);
      await ensureCalendar();

      await waitFor(
        dayButton,
        '시작일'
      );

      dayButton().click();
      await sleep(300);

      await waitFor(
        dayButton,
        '종료일'
      );

      dayButton().click();
      await sleep(300);

      const apply = await waitFor(
        () => action('적용'),
        '적용 버튼'
      );

      apply.click();

      await waitFor(
        dateVerified,
        '하루 날짜 적용 확인'
      );
    }

    send(
      '날짜 적용 완료: ' + target,
      true,
      'date'
    );

    const beforeInput =
      Array.from(
        document.querySelectorAll(
          'input[placeholder="사유 입력"][maxlength="40"]'
        )
      ).find(visible);

    if (!beforeInput) {
      const buttons =
        Array.from(
          document.querySelectorAll(
            'button[data-atelier-component="Button"]'
          )
        ).filter(el =>
          visible(el) &&
          norm(el.textContent) ===
            '엑셀 다운로드' &&
          el.getAttribute(
            'aria-disabled'
          ) !== 'true'
        );

      if (
        buttons.length !== 1
      ) {
        throw new Error(
          '다운로드 시작 버튼 확인 실패'
        );
      }

      buttons[0].click();
    }

    const input = await waitFor(
      () =>
        Array.from(
          document.querySelectorAll(
            'input[placeholder="사유 입력"][maxlength="40"]'
          )
        ).find(visible),
      '사유 입력창'
    );

    const setter =
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      ).set;

    setter.call(
      input,
      reason
    );

    input.dispatchEvent(
      new Event('input', {
        bubbles: true,
      })
    );

    input.dispatchEvent(
      new Event('change', {
        bubbles: true,
      })
    );

    await sleep(300);

    if (
      input.value !== reason
    ) {
      throw new Error(
        '사유 입력 검증 실패'
      );
    }

    const buttons =
      Array.from(
        document.querySelectorAll(
          'button[data-atelier-component="Button"]'
        )
      ).filter(el =>
        visible(el) &&
        norm(el.textContent) ===
          '엑셀 다운로드' &&
        el.getAttribute(
          'aria-disabled'
        ) !== 'true' &&
        el.getAttribute(
          'data-disabled'
        ) !== 'true' &&
        !el.disabled
      );

    if (
      buttons.length !== 2
    ) {
      throw new Error(
        '최종 다운로드 버튼 확인 실패'
      );
    }

    installDownloadCapture();

    send(
      '다운로드 요청 중...',
      true,
      'reason'
    );

    buttons[1].click();

    send(
      '파일 응답 대기 중...',
      true,
      'requested'
    );
  }

  run()
    .catch(e =>
      send(
        '자동화 오류: ' +
          String(e.message || e),
        false,
        'error'
      )
    )
    .finally(() => {
      window.__kdFeeBusy = false;
    });
})();
true;
`;
}

// ==========================================
// UI 컴포넌트
// ==========================================

function AppButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        secondary
          ? styles.secondary
          : styles.primary,
        disabled && {
          opacity: 0.5,
        },
      ]}
    >
      <Text
        style={
          secondary
            ? styles.secondaryText
            : styles.primaryText
        }
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function StatCard({
  label,
  value,
  suffix = '',
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>
        {label}
      </Text>

      <Text style={styles.cardValue}>
        {value == null
          ? '—'
          : String(value) + suffix}
      </Text>
    </View>
  );
}

function NavButton({
  label,
  active,
  onPress,
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.navBtn,
        active && styles.selected,
      ]}
    >
      <Text
        style={[
          styles.navText,
          active &&
            styles.selectedText,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ==========================================
// 메인 앱
// ==========================================

export default function App() {
  const webRef = useRef(null);
  const dateTimer = useRef(null);
  const feeModeRef = useRef(false);
  const feeDateRef = useRef(yesterday());
  const autoAttemptRef = useRef(false);
  const fileTransferRef = useRef(null);

  const [tab, setTab] =
    useState('home');

  // GPS 관제 관리자 로그인. 엑셀 복호화/배민 기능과 독립적으로 동작합니다.
  const gpsMapRef = useRef(null);
  const gpsReadyRef = useRef(false);
  const gpsBusyRef = useRef(false);
  const gpsAuthRef = useRef(null);
  const [gpsAuth, setGpsAuth] = useState(null);
  const [gpsEmail, setGpsEmail] = useState('');
  const [gpsPassword, setGpsPassword] = useState('');
  const [gpsRiders, setGpsRiders] = useState([]);
  const [gpsAccounts, setGpsAccounts] = useState([]);
  const [gpsStatus, setGpsStatus] = useState('관리자 로그인이 필요합니다');
  const [gpsUpdatedAt, setGpsUpdatedAt] = useState('없음');
  const [gpsMapError, setGpsMapError] = useState('');

  async function gpsLogin() {
    try {
      setGpsMapError('');
      const response = await fetch(GPS_SUPABASE_URL + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: {apikey:GPS_SUPABASE_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({email:gpsEmail.trim(),password:gpsPassword})
      });
      const session = await response.json();
      if (!response.ok || !session.access_token) throw new Error(session.msg || session.error_description || '로그인 실패');
      const check = await fetch(GPS_SUPABASE_URL+'/rest/v1/kd_admins?select=user_id&user_id=eq.'+encodeURIComponent(session.user.id),{
        headers:{apikey:GPS_SUPABASE_KEY,Authorization:'Bearer '+session.access_token}
      });
      const admins = await check.json();
      if (!check.ok || !Array.isArray(admins) || admins.length!==1) throw new Error('GPS 관리자 권한이 없습니다.');
      const auth={access_token:session.access_token,refresh_token:session.refresh_token,expires_at:Date.now()+(session.expires_in||3600)*1000};
      gpsAuthRef.current=auth;setGpsAuth(auth);setGpsPassword('');setGpsStatus('관리자 연결됨');
    } catch(e) { setGpsMapError(String(e.message||e)); }
  }

  function gpsLogout() {
    gpsAuthRef.current=null;setGpsAuth(null);setGpsRiders([]);setGpsAccounts([]);
    setGpsStatus('관리자 로그인이 필요합니다');
    if(gpsReadyRef.current) gpsMapRef.current?.injectJavaScript('window.__KD_UPDATE_RIDERS([]);true;');
  }

  const gpsToken = useCallback(async () => {
    let auth=gpsAuthRef.current;
    if(!auth) throw new Error('관리자 로그인이 필요합니다.');
    if(auth.expires_at-Date.now()>60000) return auth.access_token;
    const res=await fetch(GPS_SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',headers:{apikey:GPS_SUPABASE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:auth.refresh_token})
    });
    const data=await res.json();
    if(!res.ok||!data.access_token){gpsLogout();throw new Error('로그인 시간이 만료되었습니다. 다시 로그인해주세요.')}
    auth={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+(data.expires_in||3600)*1000};
    gpsAuthRef.current=auth;setGpsAuth(auth);return auth.access_token;
  }, []);

  const pushGpsMarkers = useCallback(riders => {
    if(!gpsReadyRef.current||!gpsMapRef.current)return;
    gpsMapRef.current.injectJavaScript('window.__KD_UPDATE_RIDERS('+JSON.stringify(riders)+');true;');
  },[]);

  const fetchGps = useCallback(async()=>{
    if(gpsBusyRef.current||!gpsAuthRef.current)return;
    gpsBusyRef.current=true;
    try {
      const token=await gpsToken();
      const headers={apikey:GPS_SUPABASE_KEY,Authorization:'Bearer '+token,Accept:'application/json','Cache-Control':'no-cache'};
      const [locations,accounts]=await Promise.all([
        fetch(GPS_SUPABASE_URL+'/rest/v1/rider_locations?select=id,rider_name,rider_id,latitude,longitude,accuracy,is_sharing,last_seen_at&is_sharing=eq.true&limit=1000',{headers}),
        fetch(GPS_SUPABASE_URL+'/rest/v1/rider_accounts?select=rider_id,rider_name&order=created_at.desc&limit=1000',{headers})
      ]);
      if(!locations.ok||!accounts.ok)throw new Error('Supabase 조회 오류 '+locations.status+'/'+accounts.status);
      const rows=await locations.json(),members=await accounts.json();
      if(!Array.isArray(rows)||!Array.isArray(members))throw new Error('위치 데이터 형식 오류');
      const live=rows.filter(gpsIsLive);
      setGpsRiders(live);setGpsAccounts(members);pushGpsMarkers(live);
      setGpsStatus('연결됨 · LIVE '+live.length+'명');setGpsUpdatedAt(new Date().toLocaleTimeString('ko-KR'));setGpsMapError('');
    }catch(e){setGpsMapError(String(e.message||e));setGpsStatus('위치 조회 오류')}
    finally{gpsBusyRef.current=false}
  },[gpsToken,pushGpsMarkers]);

  useEffect(()=>{if(tab!=='gps'||!gpsAuth)return;fetchGps();const timer=setInterval(fetchGps,GPS_POLL_MS);return()=>clearInterval(timer)},[tab,gpsAuth,fetchGps]);
  const onGpsMapMessage=useCallback(event=>{
    try{const msg=JSON.parse(event.nativeEvent.data);
      if(msg.type==='map-ready'){gpsReadyRef.current=true;fetchGps()}
      else if(msg.type==='map-refresh')fetchGps();
      else if(msg.type==='map-error')setGpsMapError(msg.message||'지도 오류');
    }catch(e){}
  },[fetchGps]);
  function focusGpsRider(rider){
    gpsMapRef.current?.injectJavaScript('window.__KD_FOCUS_RIDER('+JSON.stringify(String(rider.rider_id||rider.id))+');true;');
  }

  // 별도의 로컬 WebView에서 XLSX 암호를 해제합니다.
  const excelWebRef = useRef(null);
  const excelReadyRef = useRef(false);
  const excelJobRef = useRef(null);
  const excelSeqRef = useRef(0);

  function onExcelMessage(event) {
    let msg;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (msg.type === 'excel-ready') {
      excelReadyRef.current = !!msg.subtle;
      if (!msg.subtle) setSettlementError('로컬 WebView에서 Web Crypto API를 사용할 수 없습니다.');
      return;
    }
    const job = excelJobRef.current;
    if (!job || msg.id !== job.id) return;
    if (msg.type === 'excel-error') {
      excelJobRef.current = null;
      clearTimeout(job.timer);
      job.reject(new Error(msg.message || '암호 해제 실패'));
    } else if (msg.type === 'excel-start') {
      if (!Number.isInteger(msg.total) || msg.total < 1 || msg.total > 2000) {
        excelJobRef.current = null;
        clearTimeout(job.timer);
        job.reject(new Error('복호화 응답 크기 오류'));
        return;
      }
      job.total = msg.total;
      job.chunks = new Array(msg.total);
    } else if (msg.type === 'excel-chunk') {
      if (job.chunks && Number.isInteger(msg.index) && msg.index >= 0 && msg.index < job.total) {
        job.chunks[msg.index] = msg.data;
      }
    } else if (msg.type === 'excel-end') {
      excelJobRef.current = null;
      clearTimeout(job.timer);
      if (!job.chunks || job.chunks.some(x => typeof x !== 'string')) {
        job.reject(new Error('복호화 데이터 일부가 누락되었습니다.'));
        return;
      }
      try { job.resolve(JSON.parse(job.chunks.join(''))); }
      catch (e) { job.reject(new Error('복호화 결과 분석 오류: ' + String(e.message || e))); }
    }
  }

  function decryptWithLocalWebView(base64, password) {
    return new Promise((resolve, reject) => {
      if (!excelReadyRef.current || !excelWebRef.current) {
        reject(new Error('엑셀 복호화 WebView가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.'));
        return;
      }
      if (excelJobRef.current) {
        reject(new Error('이전 복호화 작업이 진행 중입니다.'));
        return;
      }
      const id = ++excelSeqRef.current;
      const timer = setTimeout(() => {
        if (excelJobRef.current?.id === id) excelJobRef.current = null;
        reject(new Error('엑셀 복호화 제한시간(120초) 초과'));
      }, 120000);
      excelJobRef.current = { id, timer, resolve, reject, total: 0, chunks: null };
      // 암호와 파일은 앱 내부의 로컬 WebView에만 전달합니다.
      excelWebRef.current.injectJavaScript(
        'window.__KD_DECRYPT(' + JSON.stringify(id) + ',' + JSON.stringify(base64) + ',' + JSON.stringify(password) + ');true;'
      );
    });
  }

  const [webTarget, setWebTarget] =
    useState(HOME);

  const [feeMode, setFeeMode] =
    useState(false);

  const [feeDate, setFeeDate] =
    useState(yesterday);

  const [feeReason, setFeeReason] =
    useState('정산용');

  const [feeMessage, setFeeMessage] =
    useState('');

  const [feeVerified, setFeeVerified] =
    useState(false);

  const [savedFile, setSavedFile] =
    useState(null);

  const [summary, setSummary] =
    useState(null);

  const [diagnostic, setDiagnostic] =
    useState(null);

  const [status, setStatus] =
    useState('배민 비즈 로그인이 필요합니다');

  const [lastUpdate, setLastUpdate] =
    useState('없음');

  const [error, setError] =
    useState('');

  const [url, setUrl] =
    useState(HOME);

  const [settlement, setSettlement] =
    useState(null);

  const [
    settlementError,
    setSettlementError,
  ] = useState('');

  const [perCall, setPerCall] =
    useState('300');

  const [withhold, setWithhold] =
    useState(false);

  const [deductions, setDeductions] =
    useState({});

  // ========================================
  // v1.4.3 비밀번호 설정
  // ========================================

  const [excelPassword, setExcelPassword] =
    useState('');

  const [passwordSaved, setPasswordSaved] =
    useState(false);

  const [showPassword, setShowPassword] =
    useState(false);

  const [autoDecrypt, setAutoDecrypt] =
    useState(false);

  const [settingsBusy, setSettingsBusy] =
    useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [stored, auto] = await Promise.all([
          SecureStore.getItemAsync(PASSWORD_KEY),
          SecureStore.getItemAsync(AUTO_KEY),
        ]);

        if (alive) {
          setPasswordSaved(Boolean(stored));
          setAutoDecrypt(auto === 'true');
        }
      } catch (e) {
        Alert.alert(
          '설정 오류',
          String(e.message || e)
        );
      } finally {
        if (alive) setSettingsBusy(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  async function saveExcelPassword() {
    if (!excelPassword.trim()) {
      Alert.alert(
        '확인',
        '엑셀 비밀번호를 입력해주세요.'
      );
      return;
    }

    try {
      await SecureStore.setItemAsync(
        PASSWORD_KEY,
        excelPassword
      );

      setPasswordSaved(true);
      setExcelPassword('');
      setShowPassword(false);

      Alert.alert(
        '저장 완료',
        '엑셀 비밀번호가 안전하게 저장되었습니다.'
      );
    } catch (e) {
      Alert.alert(
        '저장 실패',
        String(e.message || e)
      );
    }
  }

  function deleteExcelPassword() {
    Alert.alert(
      '비밀번호 삭제',
      '저장된 비밀번호를 삭제할까요?',
      [
        {
          text: '취소',
          style: 'cancel',
        },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            try {
              await SecureStore.deleteItemAsync(
                PASSWORD_KEY
              );

              await SecureStore.setItemAsync(
                AUTO_KEY,
                'false'
              );

              setPasswordSaved(false);
              setAutoDecrypt(false);
              setExcelPassword('');
              setShowPassword(false);

              Alert.alert(
                '완료',
                '저장된 비밀번호를 삭제했습니다.'
              );
            } catch (e) {
              Alert.alert(
                '삭제 실패',
                String(e.message || e)
              );
            }
          },
        },
      ]
    );
  }

  async function changeAutoDecrypt(value) {
    if (value && !passwordSaved) {
      Alert.alert(
        '비밀번호 필요',
        '먼저 엑셀 비밀번호를 등록해주세요.'
      );
      return;
    }

    try {
      await SecureStore.setItemAsync(
        AUTO_KEY,
        value ? 'true' : 'false'
      );

      setAutoDecrypt(value);
    } catch (e) {
      Alert.alert(
        '설정 실패',
        String(e.message || e)
      );
    }
  }

  function updateFeeDate(value) {
    setFeeDate(value);
    feeDateRef.current = value;
    setFeeVerified(false);
  }

  // ========================================
  // WebView 메시지 처리
  // ========================================

  const onMessage = useCallback(
    event => {
      let msg;

      try {
        msg = JSON.parse(
          event.nativeEvent.data
        );
      } catch {
        return;
      }

      if (msg.type === 'bridge-ready') {
        setStatus('기사 자동 조회 실행 중');
        return;
      }

      if (msg.type === 'summary') {
        setSummary(msg.summary);
        setDiagnostic(msg.diagnostic);

        setLastUpdate(
          new Date(msg.at).toLocaleTimeString('ko-KR')
        );

        setStatus('최근 데이터 수신 성공');
        setError('');
        return;
      }

      if (msg.type === 'monitor-error') {
        setStatus('기사 자동 조회 실패');
        setError(
          msg.message || '알 수 없는 오류'
        );
        return;
      }

      if (msg.type === 'fee-file-start') {
        if (
          msg.target !== feeDateRef.current ||
          !Number.isInteger(msg.total) ||
          msg.total < 1 ||
          msg.total > 5000
        ) {
          return;
        }

        fileTransferRef.current = {
          id: msg.id,
          target: msg.target,
          total: msg.total,
          bytes: msg.bytes,
          chunks: new Array(msg.total),
          received: 0,
        };

        setFeeMessage('엑셀 파일 수신 중...');
        return;
      }

      if (msg.type === 'fee-file-chunk') {
        const t = fileTransferRef.current;

        if (
          !t ||
          t.id !== msg.id ||
          !Number.isInteger(msg.index) ||
          msg.index < 0 ||
          msg.index >= t.total ||
          typeof msg.data !== 'string'
        ) {
          return;
        }

        if (t.chunks[msg.index] === undefined) {
          t.chunks[msg.index] = msg.data;
          t.received++;
        }

        return;
      }

      if (msg.type === 'fee-file-end') {
        const t = fileTransferRef.current;

        if (!t || t.id !== msg.id) {
          return;
        }

        fileTransferRef.current = null;

        if (
          t.received !== t.total ||
          t.chunks.some(
            x => typeof x !== 'string'
          )
        ) {
          setFeeMessage(
            '파일 수신 누락. 다시 시도해주세요.'
          );
          return;
        }

        (async () => {
          try {
            const base64 = t.chunks.join('');

            if (!isExcelBase64(base64)) {
              throw new Error(
                '엑셀 파일 서명 오류'
              );
            }

            const fileName =
              '배민정산_' + t.target + '.xlsx';

            const uri =
              FileSystem.documentDirectory +
              fileName;

            await FileSystem.writeAsStringAsync(
              uri,
              base64,
              {
                encoding:
                  FileSystem.EncodingType.Base64,
              }
            );

            const info =
              await FileSystem.getInfoAsync(uri);

            if (!info.exists || info.size === 0) {
              throw new Error(
                '저장 검증 실패'
              );
            }

            if (info.size !== t.bytes) {
              throw new Error(
                '파일 크기 불일치: ' +
                info.size + '/' + t.bytes
              );
            }

            setSavedFile({
              uri,
              name: fileName,
              size: info.size,
            });

            setFeeMessage(
              '앱 내부 저장 성공: ' +
              fileName +
              ' (' + info.size + '바이트)'
            );
          } catch (e) {
            setFeeMessage(
              '모바일 파일 저장 실패: ' +
              String(e.message || e)
            );
          }
        })();

        return;
      }

      if (msg.type === 'fee-date') {
        setFeeMessage(msg.message || '');

        if (msg.stage === 'date') {
          setFeeVerified(
            !!msg.success &&
            msg.target === feeDateRef.current
          );
        }

        if (msg.stage === 'error') {
          setFeeVerified(false);
        }

        return;
      }

      if (msg.type === 'fee-reason') {
        setFeeMessage(msg.message || '');
      }
    },
    []
  );

  // ========================================
  // 페이지 이동
  // ========================================

  function clearDateTimer() {
    if (dateTimer.current) {
      clearTimeout(dateTimer.current);
      dateTimer.current = null;
    }
  }

  function openBaemin() {
    clearDateTimer();

    feeModeRef.current = false;

    setFeeMode(false);
    setFeeVerified(false);
    setFeeMessage('');

    setWebTarget(HOME);
    setUrl(HOME);
    setTab('baemin');
  }

  function openFees() {
    if (!validDate(feeDate)) {
      Alert.alert(
        '날짜 오류',
        'YYYY-MM-DD 형식으로 입력해주세요.'
      );
      return;
    }

    clearDateTimer();

    autoAttemptRef.current = false;
    feeModeRef.current = true;
    feeDateRef.current = feeDate.trim();

    setFeeMode(true);
    setFeeVerified(false);
    setSavedFile(null);

    setFeeMessage(
      '배민 정산 페이지 연결 중...'
    );

    setWebTarget(FEES);
    setUrl(FEES);
    setTab('baemin');
  }

  function selectFeeDate() {
    if (!validDate(feeDateRef.current)) {
      Alert.alert(
        '날짜 오류',
        '정산 날짜를 확인해주세요.'
      );
      return;
    }

    setFeeVerified(false);

    setFeeMessage(
      feeDateRef.current +
      ' 자동 선택 중...'
    );

    webRef.current?.injectJavaScript(
      buildFeeScript(
        feeDateRef.current,
        feeReason
      )
    );
  }

  function onFeePageLoaded(event) {
    if (!feeModeRef.current) {
      return;
    }

    const loadedUrl =
      event?.nativeEvent?.url || '';

    if (
      !loadedUrl.includes(
        '/center/delivery-fee-download'
      )
    ) {
      setFeeMessage(
        '배민 로그인 후 정산 다운로드 페이지로 이동해주세요.'
      );
      return;
    }

    if (autoAttemptRef.current) {
      return;
    }

    autoAttemptRef.current = true;

    clearDateTimer();

    setFeeMessage(
      '페이지 로딩 완료. 자동 다운로드 준비 중...'
    );

    dateTimer.current = setTimeout(() => {
      if (!feeModeRef.current) return;
      selectFeeDate();
    }, 2200);
  }

  // ========================================
  // 다운로드 사유 입력
  // ========================================

  function fillFeeReason() {
    const reason =
      JSON.stringify(
        feeReason.slice(0, 40)
      );

    const js = `
(function () {
  const input =
    Array.from(
      document.querySelectorAll(
        'input,textarea'
      )
    ).find(el =>
      /사유/.test(
        (el.placeholder || '') +
        ' ' +
        (el.getAttribute(
          'aria-label'
        ) || '')
      )
    );

  function send(message) {
    window.ReactNativeWebView
      .postMessage(
        JSON.stringify({
          type: 'fee-reason',
          message
        })
      );
  }

  if (!input) {
    send(
      '먼저 다운로드 팝업을 열어주세요.'
    );
    return;
  }

  const proto =
    input.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

  const setter =
    Object.getOwnPropertyDescriptor(
      proto,
      'value'
    ).set;

  setter.call(
    input,
    ${reason}
  );

  input.dispatchEvent(
    new Event('input', {
      bubbles: true
    })
  );

  input.dispatchEvent(
    new Event('change', {
      bubbles: true
    })
  );

  send(
    '다운로드 사유 입력 완료'
  );
})();
true;
`;

    webRef.current?.injectJavaScript(js);
  }

  // ========================================
  // 휴대폰 다운로드 폴더로 저장
  // ========================================

  async function exportSavedFile() {
    if (!savedFile) {
      Alert.alert(
        '파일 없음',
        '먼저 정산서를 다운로드해주세요.'
      );
      return;
    }

    try {
      const saf =
        FileSystem.StorageAccessFramework;

      const result =
        await saf.requestDirectoryPermissionsAsync();

      if (!result.granted) {
        return;
      }

      const base64 =
        await FileSystem.readAsStringAsync(
          savedFile.uri,
          {
            encoding:
              FileSystem.EncodingType.Base64,
          }
        );

      const dest =
        await saf.createFileAsync(
          result.directoryUri,
          savedFile.name,
          EXCEL_MIME
        );

      await FileSystem.writeAsStringAsync(
        dest,
        base64,
        {
          encoding:
            FileSystem.EncodingType.Base64,
        }
      );

      Alert.alert(
        '저장 완료',
        '선택한 폴더에 ' +
        savedFile.name +
        ' 파일을 저장했습니다.'
      );
    } catch (e) {
      Alert.alert(
        '폴더 저장 실패',
        String(e.message || e)
      );
    }
  }

  // ========================================
  // 엑셀 읽기
  // ========================================

  async function readExcelBase64(
    uri,
    isInternal
  ) {
    const read = async source =>
      FileSystem.readAsStringAsync(
        source,
        {
          encoding:
            FileSystem.EncodingType.Base64,
        }
      );

    try {
      return await read(uri);
    } catch (firstError) {
      if (isInternal) {
        throw new Error(
          '앱 내부 파일 읽기 실패: ' +
          String(
            firstError.message ||
            firstError
          )
        );
      }

      const copyUri =
        FileSystem.documentDirectory +
        'import_' +
        Date.now() +
        '.xlsx';

      try {
        await FileSystem.copyAsync({
          from: uri,
          to: copyUri,
        });

        return await read(copyUri);
      } catch (copyError) {
        throw new Error(
          '선택한 파일을 읽을 수 없습니다. 먼저 앱 내부 저장 버튼을 사용하거나 파일 앱에서 접근 가능한 XLSX를 선택해주세요. ' +
          String(
            copyError.message ||
            copyError
          )
        );
      }
    }
  }

  // ========================================
  // 정산서 불러오기
  // ========================================

  async function importSettlement(
    useSaved = false
  ) {
    try {
      setSettlementError('');

      let fileName = '';
      let sourceUri = '';

      if (useSaved) {
        if (!savedFile?.uri) {
          throw new Error(
            '앱 내부에 저장된 정산서가 없습니다.'
          );
        }

        fileName = savedFile.name;
        sourceUri = savedFile.uri;
      } else {
        const result =
          await DocumentPicker.getDocumentAsync({
            type: [
              EXCEL_MIME,
              '*/*',
            ],
            copyToCacheDirectory: true,
          });

        if (
          result.canceled ||
          !result.assets?.length
        ) {
          return;
        }

        const asset = result.assets[0];

        fileName =
          asset.name || '선택한파일.xlsx';

        sourceUri = asset.uri;
      }

      if (!/\.xlsx$/i.test(fileName)) {
        throw new Error(
          '.xlsx 파일을 선택해주세요.'
        );
      }

      const base64 =
        await readExcelBase64(
          sourceUri,
          useSaved
        );

      // v1.4.5: encrypted XLSX Agile password reader (experimental on Expo Go)
      const all = [];
      const required = ['라이더명', '배달처리비', '배달상태', '배달번호'];

      if (base64.startsWith('0M8R4K')) {
        const password = await SecureStore.getItemAsync(PASSWORD_KEY);
        if (!password) {
          throw new Error('설정에서 엑셀 비밀번호를 먼저 등록해주세요.');
        }
        if (!autoDecrypt) {
          throw new Error('설정에서 자동 암호 해제를 켜주세요.');
        }
        const decodedRows = await decryptWithLocalWebView(base64, password);
        all.push(...decodedRows);
      } else if (base64.startsWith('UEs')) {
        let workbook;
        try {
          workbook = XLSX.read(base64, { type: 'base64' });
        } catch (e) {
          throw new Error('엑셀 분석 실패: ' + String(e.message || e));
        }
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
          const headerIndex = matrix.findIndex(row =>
            required.every(key => (row || []).some(cell => String(cell ?? '').trim() === key))
          );
          if (headerIndex < 0) continue;
          const headers = matrix[headerIndex].map(cell => String(cell ?? '').trim());
          for (const values of matrix.slice(headerIndex + 1)) {
            const record = {};
            headers.forEach((header, i) => { if (header) record[header] = values[i] ?? ''; });
            all.push(record);
          }
        }
      } else {
        throw new Error('지원되지 않는 엑셀 파일 형식입니다.');
      }

      if (!all.length) {
        throw new Error(
          '배민 정산서의 필수 열을 찾지 못했습니다. ' +
          '라이더명, 배달처리비, 배달상태, 배달번호를 확인해주세요.'
        );
      }

      const map = new Map();
      const seen = new Set();

      let duplicates = 0;

      all.forEach(row => {
        const name =
          String(
            row['라이더명'] || ''
          ).trim();

        const id =
          String(
            row['라이더ID'] ||
            row['User ID'] ||
            name
          ).trim();

        const deliveryNo =
          String(
            row['배달번호'] || ''
          ).trim();

        const day =
          String(
            row['운행일'] || ''
          ).trim();

        if (!name || !deliveryNo) {
          return;
        }

        const key =
          day + '|' + deliveryNo;

        if (seen.has(key)) {
          duplicates++;
          return;
        }

        seen.add(key);

        if (!map.has(id)) {
          map.set(id, {
            id,
            name,
            completed: 0,
            canceled: 0,
            amount: 0,
          });
        }

        const rider = map.get(id);

        rider.amount +=
          num(row['배달처리비']);

        const state =
          String(
            row['배달상태'] || ''
          ).trim();

        if (
          state === '전달완료' ||
          state === '배달완료'
        ) {
          rider.completed++;
        } else if (/취소/.test(state)) {
          rider.canceled++;
        }
      });

      const riders =
        Array.from(map.values()).sort(
          (a, b) =>
            b.amount - a.amount
        );

      if (!riders.length) {
        throw new Error(
          '유효한 배달 기록이 없습니다.'
        );
      }

      setSettlement({
        file: fileName,
        riders,
        records: seen.size,
        duplicates,
      });

      setDeductions({});
      setTab('settlement');

      Alert.alert(
        '정산서 불러오기 성공',
        '기사 ' +
        riders.length +
        '명, 배달기록 ' +
        seen.size +
        '건을 불러왔습니다.'
      );
    } catch (e) {
      const message =
        String(e?.message || e);

      setSettlementError(message);

      Alert.alert(
        '정산서 불러오기 실패',
        message
      );
    }
  }

  // ========================================
  // 정산 계산
  // ========================================

  function calc(rider) {
    const fee =
      rider.completed *
      Math.max(0, num(perCall));

    const extra =
      Math.max(
        0,
        num(deductions[rider.id])
      );

    const base =
      rider.amount - fee - extra;

    const tax =
      withhold
        ? Math.floor(
            Math.max(0, base) * 0.033
          )
        : 0;

    return {
      fee,
      extra,
      tax,
      pay: base - tax,
    };
  }

  const totals =
    (settlement?.riders || []).reduce(
      (sum, rider) => {
        const value = calc(rider);

        return {
          completed:
            sum.completed +
            rider.completed,

          amount:
            sum.amount +
            rider.amount,

          fee:
            sum.fee +
            value.fee,

          tax:
            sum.tax +
            value.tax,

          pay:
            sum.pay +
            value.pay,
        };
      },
      {
        completed: 0,
        amount: 0,
        fee: 0,
        tax: 0,
        pay: 0,
      }
    );

  // ========================================
  // 화면
  // ========================================

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={styles.root}
        edges={['top', 'bottom']}
      >
        <StatusBar
          barStyle="dark-content"
          backgroundColor="#F5F8FC"
        />

        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>
              K
            </Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.logo}>
              고려딜리버리
            </Text>

            <Text style={styles.sub}>
              RIDER CONTROL · v1.6.0
            </Text>
          </View>

          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>
              LIVE
            </Text>
          </View>
        </View>

        <View style={styles.nav}>
          <NavButton
            label="대시보드"
            active={tab === 'home'}
            onPress={() => setTab('home')}
          />

          <NavButton
            label="배민 조회"
            active={
              tab === 'baemin' && !feeMode
            }
            onPress={openBaemin}
          />

          <NavButton
            label="GPS 지도"
            active={tab === 'gps'}
            onPress={() => setTab('gps')}
          />

          <NavButton
            label="정산 관리"
            active={
              tab === 'settlement' ||
              (tab === 'baemin' && feeMode)
            }
            onPress={() => setTab('settlement')}
          />

          <NavButton
            label="설정"
            active={tab === 'settings'}
            onPress={() => setTab('settings')}
          />
        </View>

        {/* ==================================
            설정
        ================================== */}

        {tab === 'settings' && (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.eyebrow}>
              SETTINGS
            </Text>

            <Text style={styles.title}>
              설정
            </Text>

            <View style={styles.info}>
              <Text style={styles.infoTitle}>
                배민 엑셀 비밀번호 관리
              </Text>

              <Text style={styles.muted}>
                저장 상태:{' '}
                {settingsBusy
                  ? '확인 중'
                  : passwordSaved
                    ? '설정됨'
                    : '미설정'}
              </Text>

              <Text style={styles.hint}>
                비밀번호는 휴대폰의 보안 저장소에
                저장됩니다. 앱 코드에 직접 입력하지
                않아도 됩니다.
              </Text>

              <TextInput
                style={styles.field}
                placeholder={
                  passwordSaved
                    ? '새 비밀번호 입력 (변경)'
                    : '엑셀 비밀번호 입력'
                }
                value={excelPassword}
                onChangeText={setExcelPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View style={styles.switchRow}>
                <Text style={styles.infoText}>
                  비밀번호 표시
                </Text>

                <Switch
                  value={showPassword}
                  onValueChange={setShowPassword}
                />
              </View>

              <AppButton
                label={
                  passwordSaved
                    ? '비밀번호 변경 및 저장'
                    : '비밀번호 등록'
                }
                onPress={saveExcelPassword}
                disabled={settingsBusy}
              />

              {passwordSaved && (
                <AppButton
                  label="저장된 비밀번호 삭제"
                  secondary
                  onPress={deleteExcelPassword}
                />
              )}
            </View>

            <View style={styles.info}>
              <Text style={styles.infoTitle}>
                엑셀 자동 암호 해제
              </Text>

              <View style={styles.switchRow}>
                <Text style={styles.infoText}>
                  자동 해제 사용 설정
                </Text>

                <Switch
                  value={autoDecrypt}
                  onValueChange={changeAutoDecrypt}
                  disabled={settingsBusy}
                />
              </View>

              <Text style={styles.hint}>
                자동 해제 설정은 저장됩니다.
                암호화 XLSX 복호화를 시험합니다.
                Expo Go에서는 Web Crypto API가 없어 실패할 수 있습니다.
              </Text>
            </View>

            <View style={styles.info}>
              <Text style={styles.infoTitle}>
                앱 정보
              </Text>

              <Text style={styles.infoText}>
                고려딜리버리 RIDER CONTROL
              </Text>

              <Text style={styles.muted}>
                버전 1.4.4
              </Text>
            </View>
          </ScrollView>
        )}

        {/* ==================================
            대시보드
        ================================== */}

        {tab === 'home' && (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.content}
          >
            <Text style={styles.eyebrow}>
              TODAY'S OVERVIEW
            </Text>

            <Text style={styles.title}>
              기사 현황
            </Text>

            <View style={styles.grid}>
              <StatCard
                label="전체 기사"
                value={summary?.total}
                suffix="명"
              />

              <StatCard
                label="운행중"
                value={summary?.active}
                suffix="명"
              />

              <StatCard
                label="완료 건수"
                value={summary?.completed}
                suffix="건"
              />

              <StatCard
                label="거절 건수"
                value={summary?.rejected}
                suffix="건"
              />

              <StatCard
                label="취소 건수"
                value={summary?.canceled}
                suffix="건"
              />

              <StatCard
                label="귀책 건수"
                value={summary?.riderFault}
                suffix="건"
              />
            </View>

            <View style={styles.info}>
              <Text style={styles.infoTitle}>
                ● 연결 상태
              </Text>

              <Text style={styles.infoText}>
                {status}
              </Text>

              <Text style={styles.muted}>
                마지막 수신: {lastUpdate}
              </Text>

              {diagnostic && (
                <Text style={styles.muted}>
                  수집 {diagnostic.collected}명
                  {' / '}
                  페이지2{' '}
                  {diagnostic.page2
                    ? diagnostic.secondOk
                      ? '성공'
                      : '실패'
                    : '없음'}
                </Text>
              )}

              {!!error && (
                <Text style={styles.error}>
                  {error}
                </Text>
              )}
            </View>

            <AppButton
              label="배민 비즈 로그인 / 수집 시작"
              onPress={openBaemin}
            />

            <Text style={styles.hint}>
              완료 건수는 총 배달완료 기준입니다.
              거절·취소·귀책은 SLA 합계 기준입니다.
            </Text>
          </ScrollView>
        )}

        {/* ==================================
            정산 관리
        ================================== */}

        {tab === 'settlement' && (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.eyebrow}>
              SETTLEMENT
            </Text>

            <Text style={styles.title}>
              기사별 자동 정산
            </Text>

            <View style={styles.info}>
              <Text style={styles.infoTitle}>
                배민 정산서 다운로드
              </Text>

              <Text style={styles.hint}>
                정산 날짜를 선택하면 배민 달력에서
                자동으로 해당 날짜를 선택합니다.
              </Text>

              <Text style={styles.muted}>
                정산 날짜
              </Text>

              <TextInput
                style={styles.field}
                value={feeDate}
                onChangeText={updateFeeDate}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
              />

              <AppButton
                label="어제 날짜로 설정"
                secondary
                onPress={() =>
                  updateFeeDate(yesterday())
                }
              />

              <Text style={styles.muted}>
                다운로드 사유
              </Text>

              <TextInput
                style={styles.field}
                value={feeReason}
                onChangeText={value =>
                  setFeeReason(
                    value.slice(0, 40)
                  )
                }
                placeholder="정산용"
              />

              <AppButton
                label="배민 날짜 선택 및 엑셀 자동 다운로드"
                onPress={openFees}
              />
            </View>

            {savedFile && (
              <View style={styles.info}>
                <Text style={styles.infoTitle}>
                  앱에 저장된 정산서
                </Text>

                <Text style={styles.muted}>
                  {savedFile.name}
                  {' · '}
                  {savedFile.size}바이트
                </Text>

                <AppButton
                  label="휴대폰 다운로드 폴더에 저장"
                  onPress={exportSavedFile}
                />

                <AppButton
                  label="앱에 저장된 정산서 바로 불러오기"
                  secondary
                  onPress={() =>
                    importSettlement(true)
                  }
                />
              </View>
            )}

            <AppButton
              label="다운로드한 엑셀 불러오기"
              onPress={() =>
                importSettlement(false)
              }
            />

            <Text style={styles.hint}>
              암호화된 엑셀은 원본 파일로 저장할 수
              있지만, 설정에서 비밀번호와 자동 해제를 켠 뒤 불러오세요.
              Expo Go에서는 복호화가 지원되지 않을 수 있습니다.
            </Text>

            {!!settlementError && (
              <Text style={styles.error}>
                {settlementError}
              </Text>
            )}

            {settlement && (
              <>
                <View style={styles.info}>
                  <Text style={styles.infoTitle}>
                    불러온 정산서
                  </Text>

                  <Text style={styles.muted}>
                    {settlement.file}
                  </Text>

                  <Text style={styles.infoText}>
                    기사 {settlement.riders.length}명
                    {' · '}
                    배달기록 {settlement.records}건
                    {' · '}
                    중복 제외 {settlement.duplicates}건
                  </Text>
                </View>

                <View style={styles.info}>
                  <Text style={styles.infoTitle}>
                    정산 설정
                  </Text>

                  <Text style={styles.muted}>
                    건당 수수료 (원)
                  </Text>

                  <TextInput
                    style={styles.field}
                    keyboardType="numeric"
                    value={perCall}
                    onChangeText={setPerCall}
                  />

                  <View style={styles.switchRow}>
                    <Text style={styles.infoText}>
                      3.3% 원천징수
                    </Text>

                    <Switch
                      value={withhold}
                      onValueChange={setWithhold}
                    />
                  </View>

                  <Text style={styles.hint}>
                    원천징수 적용 여부는 실제 계약 및
                    세무 기준에 맞게 확인해주세요.
                  </Text>
                </View>

                <View style={styles.info}>
                  <Text style={styles.infoTitle}>
                    전체 정산 요약
                  </Text>

                  <Text style={styles.infoText}>
                    완료 {totals.completed}건
                  </Text>

                  <Text style={styles.infoText}>
                    배달처리비 {money(totals.amount)}
                  </Text>

                  <Text style={styles.muted}>
                    수수료 -{money(totals.fee)}
                  </Text>

                  <Text style={styles.muted}>
                    원천징수 -{money(totals.tax)}
                  </Text>

                  <Text style={styles.payValue}>
                    지급 예정 {money(totals.pay)}
                  </Text>
                </View>

                {settlement.riders.map(rider => {
                  const result = calc(rider);

                  return (
                    <View
                      key={rider.id}
                      style={styles.info}
                    >
                      <Text style={styles.infoTitle}>
                        {rider.name} 기사
                      </Text>

                      <Text style={styles.infoText}>
                        완료 {rider.completed}건
                        {' · '}
                        취소 {rider.canceled}건
                      </Text>

                      <Text style={styles.muted}>
                        배달처리비 {money(rider.amount)}
                      </Text>

                      <Text style={styles.muted}>
                        수수료 -{money(result.fee)}
                        {' · '}
                        세금 -{money(result.tax)}
                      </Text>

                      <Text style={styles.muted}>
                        기타 차감액
                      </Text>

                      <TextInput
                        style={styles.field}
                        keyboardType="numeric"
                        placeholder="0"
                        value={
                          deductions[rider.id] || ''
                        }
                        onChangeText={value =>
                          setDeductions(prev => ({
                            ...prev,
                            [rider.id]: value,
                          }))
                        }
                      />

                      <Text style={styles.payValue}>
                        지급액 {money(result.pay)}
                      </Text>
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>
        )}

        {/* ==================================
            기사 GPS 실시간 지도 (조회 전용)
        ================================== */}
        {tab === 'gps' && (
          <View style={{flex:1,backgroundColor:'#F2F6FB',padding:10}}>
            {!gpsAuth ? (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:18,backgroundColor:'white',borderRadius:16}}>
                <Text style={{fontSize:22,fontWeight:'800',color:'#162D4C'}}>GPS 관리자 로그인</Text>
                <Text style={{color:'#77879A',marginVertical:12}}>기사 위치는 관리자 계정으로 로그인한 경우에만 조회할 수 있습니다.</Text>
                <TextInput placeholder="관리자 이메일" autoCapitalize="none" keyboardType="email-address" value={gpsEmail} onChangeText={setGpsEmail} style={{borderWidth:1,borderColor:'#DCE5F0',borderRadius:10,padding:13,marginBottom:9}} />
                <TextInput placeholder="관리자 비밀번호" secureTextEntry value={gpsPassword} onChangeText={setGpsPassword} style={{borderWidth:1,borderColor:'#DCE5F0',borderRadius:10,padding:13,marginBottom:9}} />
                <AppButton label="관리자 로그인" onPress={gpsLogin}/>
                {!!gpsMapError&&<Text style={{color:'#C44',marginTop:12}}>{gpsMapError}</Text>}
              </ScrollView>
            ) : (
              <>
                <View style={{backgroundColor:'white',padding:12,borderRadius:14,marginBottom:8}}>
                  <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
                    <View><Text style={{fontSize:19,fontWeight:'800',color:'#152C49'}}>기사 위치 관제</Text><Text style={{color:'#76869A',fontSize:12,marginTop:5}}>등록 {gpsAccounts.length}명 · LIVE {gpsRiders.length}명</Text></View>
                    <TouchableOpacity onPress={gpsLogout}><Text style={{color:'#62778F',fontSize:12}}>로그아웃</Text></TouchableOpacity>
                  </View>
                </View>
                <View style={{flex:1,minHeight:250,borderRadius:14,overflow:'hidden'}}>
                  <WebView ref={gpsMapRef} source={{html:RIDER_MAP_HTML,baseUrl:'https://localhost/'}} originWhitelist={['*']} javaScriptEnabled domStorageEnabled={false} onMessage={onGpsMapMessage} onError={e=>setGpsMapError('지도 오류: '+e.nativeEvent.description)} onLoadEnd={()=>gpsMapRef.current?.injectJavaScript('window.__KD_MAP_RESIZE&&window.__KD_MAP_RESIZE();true;')} style={{flex:1,backgroundColor:'#E7EDF5'}} />
                </View>
                <View style={{backgroundColor:'white',padding:12,borderRadius:12,marginTop:8,maxHeight:190}}>
                  <View style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{fontWeight:'800',color:'#1C3552'}}>기사 목록</Text><TouchableOpacity onPress={fetchGps}><Text style={{color:'#2582EA'}}>⟳ 새로고침</Text></TouchableOpacity></View>
                  <ScrollView style={{marginTop:6}}>{gpsAccounts.length===0?<Text style={{color:'#8A9BAD',padding:10}}>아직 발급된 기사 계정이 없습니다.</Text>:gpsAccounts.map(r=>{
                    const live=gpsRiders.find(x=>x.rider_id===r.rider_id);
                    return <TouchableOpacity key={r.rider_id} disabled={!live} onPress={()=>focusGpsRider(live)} style={{paddingVertical:9,borderBottomWidth:1,borderColor:'#EDF1F6'}}><Text style={{fontWeight:'700',color:'#19334E'}}>{live?'🟢':'⚪'} {r.rider_name} <Text style={{fontSize:11,color:'#8A9AAC'}}>({r.rider_id})</Text></Text><Text style={{fontSize:11,color:'#8A9AAC'}}>{live?'LIVE · 위치 보려면 터치':'오프라인'}</Text></TouchableOpacity>
                  })}</ScrollView>
                </View>
                {!!gpsMapError&&<Text style={{color:'#C44',fontSize:11,marginTop:5}}>{gpsMapError}</Text>}
              </>
            )}
          </View>
        )}

        {/* ==================================
            배민 WebView
        ================================== */}

        <View
          style={{
            flex: 1,
            display:
              tab === 'baemin'
                ? 'flex'
                : 'none',
          }}
        >
          <View style={styles.webHeader}>
            <Text
              style={styles.webTitle}
              numberOfLines={1}
            >
              {url}
            </Text>

            <TouchableOpacity
              onPress={() => {
                autoAttemptRef.current = false;
                webRef.current?.reload();
              }}
            >
              <Text style={styles.reload}>
                새로고침
              </Text>
            </TouchableOpacity>
          </View>

          <WebView
            key={
              webTarget +
              (feeMode
                ? '-desktop'
                : '-mobile')
            }
            ref={webRef}
            source={{ uri: webTarget }}
            userAgent={
              feeMode
                ? DESKTOP_UA
                : undefined
            }
            originWhitelist={['https://*']}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            injectedJavaScript={
              feeMode
                ? 'true;'
                : MONITOR_JS
            }
            onMessage={onMessage}
            onNavigationStateChange={state =>
              setUrl(state.url)
            }
            onLoadEnd={onFeePageLoaded}
            onShouldStartLoadWithRequest={req =>
              req.url.startsWith('https://')
            }
            startInLoadingState
            renderLoading={() => (
              <ActivityIndicator
                size="large"
                color="#2385ED"
                style={styles.loading}
              />
            )}
            onError={e =>
              setError(
                '웹뷰 오류: ' +
                e.nativeEvent.description
              )
            }
          />

          {feeMode && (
            <View style={styles.feeControls}>
              <Text style={styles.feeControlTitle}>
                정산 날짜: {feeDate}
              </Text>

              <AppButton
                label="날짜 선택 및 다운로드 다시 실행"
                onPress={selectFeeDate}
              />

              <View
                style={[
                  styles.verification,
                  feeVerified &&
                    styles.verified,
                ]}
              >
                <Text
                  style={[
                    styles.verificationText,
                    feeVerified &&
                      styles.verifiedText,
                  ]}
                >
                  {feeVerified
                    ? '✓ 날짜 선택 확인'
                    : '날짜 확인 대기'}
                </Text>
              </View>

              {savedFile && (
                <>
                  <AppButton
                    label="휴대폰 다운로드 폴더에 저장"
                    onPress={exportSavedFile}
                  />

                  <AppButton
                    label="앱에 저장된 정산서 바로 불러오기"
                    secondary
                    onPress={() =>
                      importSettlement(true)
                    }
                  />
                </>
              )}

              <AppButton
                label="다운로드 사유 자동 입력"
                secondary
                onPress={fillFeeReason}
              />
            </View>
          )}

          {!!feeMessage && (
            <Text style={styles.feeMessage}>
              {feeMessage}
            </Text>
          )}

          <Text style={styles.webNote}>
            {feeMode
              ? '파일 수신 후 앱 내부에 저장됩니다. 저장 성공 시 다운로드 폴더로 내보낼 수 있습니다.'
              : '로그인 후 배달현황 페이지를 열어두세요.'}
          </Text>
        </View>
        {/* 앱 내부 오프라인 XLSX 복호화 전용 WebView */}
        <View pointerEvents="none" style={{ width: 1, height: 1, opacity: 0, position: 'absolute', bottom: 0, left: 0 }}>
          <WebView
            ref={excelWebRef}
            source={{ html: EXCEL_BRIDGE_HTML, baseUrl: 'https://localhost/' }}
            originWhitelist={['https://*']}
            javaScriptEnabled
            domStorageEnabled={false}
            onMessage={onExcelMessage}
            onError={e => setSettlementError('복호화 WebView 오류: ' + e.nativeEvent.description)}
            scrollEnabled={false}
          />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ==========================================
// 스타일
// ==========================================

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F8FC',
  },

  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#EBF0F7',
  },

  brandMark: {
    width: 40,
    height: 40,
    backgroundColor: '#237FF4',
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },

  brandMarkText: {
    fontSize: 23,
    color: '#FFF',
    fontWeight: '900',
  },

  logo: {
    fontSize: 19,
    fontWeight: '900',
    color: '#182D4D',
  },

  sub: {
    color: '#91A0B3',
    marginTop: 3,
    fontSize: 10,
    fontWeight: '700',
  },

  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EAF9F1',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },

  liveDot: {
    width: 6,
    height: 6,
    backgroundColor: '#20B56B',
    borderRadius: 3,
  },

  liveText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#15985B',
  },

  nav: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    paddingHorizontal: 10,
    paddingBottom: 14,
    gap: 5,
  },

  navBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#F2F5FA',
    borderRadius: 12,
    alignItems: 'center',
  },

  selected: {
    backgroundColor: '#247EF0',
  },

  navText: {
    fontWeight: '800',
    color: '#294A70',
    fontSize: 11,
  },

  selectedText: {
    color: '#FFF',
  },

  content: {
    padding: 18,
    paddingBottom: 48,
  },

  eyebrow: {
    color: '#2581EE',
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 1.5,
    marginTop: 8,
    marginBottom: 6,
  },

  title: {
    fontSize: 25,
    fontWeight: '900',
    color: '#182D4D',
    marginBottom: 19,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },

  card: {
    width: '48%',
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 18,
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    elevation: 2,
  },

  cardLabel: {
    color: '#8192A8',
    fontSize: 13,
    fontWeight: '700',
  },

  cardValue: {
    color: '#1D4D87',
    fontSize: 30,
    fontWeight: '900',
    marginTop: 14,
  },

  info: {
    backgroundColor: '#FFF',
    padding: 19,
    borderRadius: 20,
    marginTop: 17,
    borderWidth: 1,
    borderColor: '#EDF1F7',
  },

  infoTitle: {
    fontWeight: '900',
    fontSize: 16,
    color: '#1B3457',
  },

  infoText: {
    color: '#325A86',
    marginTop: 11,
    lineHeight: 21,
  },

  muted: {
    color: '#8596AA',
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
  },

  error: {
    color: '#C04444',
    marginTop: 10,
  },

  primary: {
    backgroundColor: '#247FF0',
    padding: 17,
    borderRadius: 15,
    marginTop: 16,
    alignItems: 'center',
  },

  primaryText: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 15,
    textAlign: 'center',
  },

  secondary: {
    backgroundColor: '#E8F2FF',
    padding: 13,
    borderRadius: 13,
    marginTop: 9,
    alignItems: 'center',
  },

  secondaryText: {
    color: '#247FF0',
    fontWeight: '900',
    fontSize: 14,
  },

  hint: {
    color: '#7E90A5',
    lineHeight: 21,
    marginTop: 14,
    fontSize: 12,
  },

  webHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFF',
  },

  webTitle: {
    color: '#72849A',
    flex: 1,
    fontSize: 11,
  },

  reload: {
    color: '#247FF0',
    fontWeight: '800',
    marginLeft: 10,
  },

  field: {
    marginTop: 7,
    backgroundColor: '#F8FAFD',
    borderWidth: 1,
    borderColor: '#DFE8F2',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 15,
    color: '#203B5D',
  },

  webNote: {
    backgroundColor: '#EBF4FF',
    padding: 12,
    color: '#537494',
    fontSize: 11,
    lineHeight: 18,
  },

  loading: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
  },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },

  payValue: {
    color: '#1D4D87',
    fontSize: 24,
    fontWeight: '900',
    marginTop: 14,
  },

  feeControls: {
    backgroundColor: '#F5F8FC',
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 12,
  },

  feeControlTitle: {
    color: '#1B3457',
    fontWeight: '800',
    fontSize: 13,
  },

  verification: {
    backgroundColor: '#E6ECF4',
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
    marginTop: 10,
  },

  verified: {
    backgroundColor: '#E0F5E9',
  },

  verificationText: {
    color: '#8192A8',
    fontWeight: '800',
    fontSize: 13,
  },

  verifiedText: {
    color: '#168B55',
  },

  feeMessage: {
    color: '#315C87',
    backgroundColor: '#EBF4FF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 12,
    lineHeight: 18,
  },
});
