// ─────────────────────────────────────────────────────────────
// 11-charts.js — AIRAC 차트 관리 · PDF 뷰어 · 위치 보정
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
// ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════
// CHARTS — AIRAC 차트 관리 기능
// ══════════════════════════════════════════════════════
let localPdfKeys = new Set();
let importProgress = null;

const chartCatColors = {
    AD: '#29b6f6', SID: '#4caf50', STAR: '#ff9800', IAP: '#e91e63', TEXT: '#9c27b0', ENR: '#26c6da', GEN: '#ffa726'
};

// 특정 공항에 속하지 않는 섹션(항로/일반)용 가상 그룹 코드
const ENROUTE_GROUP = 'ENRT';
const GENERAL_GROUP = 'GENL';
// 가상 그룹 표시 정보 (목록 상단에 별도 표시)
const SECTION_GROUPS = {
    [ENROUTE_GROUP]: { label: '🗺 ENROUTE', sub: '항로 차트', color: '#26c6da', name: 'ENROUTE (항로)', order: 0 },
    [GENERAL_GROUP]: { label: '📖 GENERAL', sub: '일반(GEN)',  color: '#ffa726', name: 'GENERAL (일반)', order: 1 },
};

const sectionTypes = [
    { cat: 'SID',  num: 'SID',  name: 'SID (표준 출발 절차)' },
    { cat: 'STAR', num: 'STAR', name: 'STAR (표준 도착 절차)' },
    { cat: 'IAP',  num: 'IAP',  name: 'IAP (계기 접근 절차)' },
    { cat: 'TEXT', num: 'HTML', name: 'AERODROME INFO (eAIP)' },
];

function isSectionLink(c) {
    return sectionTypes.some(st => st.num === c.chartNum);
}

const airportSpecificCharts = {
    RKSI: [
        { cat: 'AD',  num: '2-1',  name: 'AD CHART' },
        { cat: 'AD',  num: '2-18', name: 'AD OBSTACLE CHART TYPE B' },
        { cat: 'SID', num: '2-27', name: 'AREA CHART_DEP' },
        { cat: 'IAP', num: '2-51', name: 'INSTR APCH CHART' },
        { cat: 'IAP', num: '2-71', name: 'VISUAL APCH CHART' },
    ],
    RKSS: [
        { cat: 'AD',  num: '2-3',  name: 'AIRCRAFT PARKING DOCKING CHART' },
        { cat: 'AD',  num: '2-5',  name: 'AD GROUND MOVEMENT CHART' },
        { cat: 'AD',  num: '2-7',  name: 'AD OBSTACLE CHART TYPE A' },
        { cat: 'IAP', num: '2-29', name: 'INSTR APCH CHART' },
    ],
    RKPC: [
        { cat: 'AD',  num: '2-3',  name: 'AIRCRAFT PARKING DOCKING CHART' },
        { cat: 'IAP', num: '2-22', name: 'INSTR APCH CHART' },
    ],
    RKPK: [
        { cat: 'SID', num: '2-13', name: 'SID' },
        { cat: 'IAP', num: '2-25', name: 'INSTR APCH CHART' },
    ],
    RKTN: [
        { cat: 'AD',  num: '2-5',  name: 'AD OBSTACLE CHART TYPE A' },
    ],
    RKTU: [
        { cat: 'AD',  num: '2-9',  name: 'AD OBSTACLE CHART TYPE B' },
        { cat: 'IAP', num: '2-17', name: 'INSTR APCH CHART' },
    ],
    RKJB: [
        { cat: 'AD',  num: '2-5',  name: 'AD OBSTACLE CHART TYPE A' },
        { cat: 'AD',  num: '2-6',  name: 'AD OBSTACLE CHART TYPE B' },
        { cat: 'IAP', num: '2-13', name: 'INSTR APCH CHART' },
    ],
    RKJJ: [
        { cat: 'AD',  num: '2-10', name: 'AREA CHART' },
        { cat: 'SID', num: '2-11', name: 'SID' },
        { cat: 'IAP', num: '2-15', name: 'INSTR APCH CHART' },
    ],
    RKNY: [
        { cat: 'AD',  num: '2-2',  name: 'AIRCRAFT PARKING DOCKING CHART' },
        { cat: 'AD',  num: '2-6',  name: 'AD OBSTACLE CHART TYPE B' },
    ],
    RKTL: [
        { cat: 'AD',  num: '2-3',  name: 'AIRCRAFT PARKING DOCKING CHART' },
        { cat: 'IAP', num: '2-18', name: 'INSTR APCH CHART' },
    ],
    RKPD: [
        { cat: 'IAP', num: '2-13', name: 'INSTR APCH CHART' },
    ],
    RKSM: [
        { cat: 'IAP', num: '2-11', name: 'INSTR APCH CHART' },
    ],
};

function inferChartCat(c) {
    if (c.cat) return c.cat;
    const name = (c.chartName || '').toUpperCase();
    if (c.chartNum === 'HTML' || c.chartNum === 'TEXT') return 'TEXT';
    if (name.includes('VISUAL') || name.includes('APCH') || name.includes('ILS') || name.includes('VOR')) return 'IAP';
    if (name.includes('STAR') || name.includes('ARR')) return 'STAR';
    if (name.includes('SID') || name.includes('DEP')) return 'SID';
    return 'AD';
}

const chartAirportList = [
    { icao: 'RKSI', name: '인천국제', nameEn: 'Incheon Intl', cat: 'INT' },
    { icao: 'RKSS', name: '김포국제', nameEn: 'Gimpo Intl', cat: 'INT' },
    { icao: 'RKPC', name: '제주국제', nameEn: 'Jeju Intl', cat: 'INT' },
    { icao: 'RKPK', name: '김해국제', nameEn: 'Gimhae Intl', cat: 'INT' },
    { icao: 'RKTN', name: '대구국제', nameEn: 'Daegu Intl', cat: 'INT' },
    { icao: 'RKTU', name: '청주국제', nameEn: 'Cheongju Intl', cat: 'INT' },
    { icao: 'RKJB', name: '무안국제', nameEn: 'Muan Intl', cat: 'INT' },
    { icao: 'RKNY', name: '양양국제', nameEn: 'Yangyang Intl', cat: 'INT' },
    { icao: 'RKTF', name: '사천', nameEn: 'Sacheon', cat: 'DOM' },
    { icao: 'RKJJ', name: '광주', nameEn: 'Gwangju', cat: 'DOM' },
    { icao: 'RKTH', name: '포항경주', nameEn: 'Pohang', cat: 'DOM' },
    { icao: 'RKJY', name: '여수', nameEn: 'Yeosu', cat: 'DOM' },
    { icao: 'RKPU', name: '울산', nameEn: 'Ulsan', cat: 'DOM' },
    { icao: 'RKTL', name: '울진', nameEn: 'Uljin', cat: 'DOM' },
    { icao: 'RKPD', name: '정석(제주)', nameEn: 'Jeongseok', cat: 'DOM' },
    { icao: 'RKNN', name: '강릉', nameEn: 'Gangneung', cat: 'MIL' },
    { icao: 'RKJK', name: '군산', nameEn: 'Gunsan', cat: 'MIL' },
    { icao: 'RKNW', name: '원주', nameEn: 'Wonju', cat: 'MIL' },
    { icao: 'RKSO', name: '오산', nameEn: 'Osan AB', cat: 'MIL' },
    { icao: 'RKSM', name: '서울', nameEn: 'Seoul AB', cat: 'MIL' },
    { icao: 'RKSG', name: '평택', nameEn: 'Pyeongtaek', cat: 'MIL' },
    { icao: 'RKPS', name: '진해', nameEn: 'Jinhae', cat: 'MIL' },
];

// --- Charts Functions ---
function loadSavedCharts() {
    try {
        const raw = JSON.parse(localStorage.getItem('savedCharts') || '[]');
        let dirty = false;
        raw.forEach(c => {
            if (c.url && c.url.startsWith('http://')) { c.url = c.url.replace('http://', 'https://'); dirty = true; }
        });
        if (!localStorage.getItem('verifyFix_v1')) {
            raw.forEach(c => {
                if (c.status === 'verified' && !isSectionLink(c)) { c.status = 'unverified'; delete c.verifiedAt; dirty = true; }
            });
            localStorage.setItem('verifyFix_v1', '1');
        }
        const seen = new Set();
        const deduped = [];
        raw.forEach(c => {
            const key = `${c.icao}|${c.chartNum}|${c.airac}`;
            if (!seen.has(key)) { seen.add(key); deduped.push(c); } else { dirty = true; }
        });
        if (dirty) localStorage.setItem('savedCharts', JSON.stringify(deduped));
        return deduped;
    } catch(e) { return []; }
}

function openAimPackage() {
    uiOpenExternal('https://aim.koca.go.kr/eaipPub/Package/history-en-GB.html?language=ko_KR');
}

function buildChartPdfUrl(airacStart, icao, num, name) {
    return `https://aim.koca.go.kr/eaipPub/Package/${airacStart}-AIRAC/pdf/AD/${icao}/(${num})%20${name.replace(/ /g, '%20')}.pdf`;
}

// --- IndexedDB PDF Storage ---
let _idb = null;
function openIDB() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise((res, rej) => {
        const req = indexedDB.open('CduCharts', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('pdfs');
        req.onsuccess = e => { _idb = e.target.result; res(_idb); };
        req.onerror = e => rej(e.target.error);
    });
}
async function idbPut(key, blob) {
    const db = await openIDB();
    return new Promise((res, rej) => {
        const tx = db.transaction('pdfs', 'readwrite');
        tx.objectStore('pdfs').put(blob, key);
        tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
    });
}
// 연결을 닫아 iOS WebKit이 버퍼링한 blob 쓰기를 디스크로 flush하고 메모리를
// 회수하도록 유도한다(대량 저장 중 60% 부근 리셋 방지 핵심).
function idbClose() {
    if (_idb) { try { _idb.close(); } catch(e) { _swallow(e); } _idb = null; }
}
async function idbGet(key) {
    const db = await openIDB();
    return new Promise((res, rej) => {
        const tx = db.transaction('pdfs', 'readonly');
        const req = tx.objectStore('pdfs').get(key);
        req.onsuccess = e => res(e.target.result || null);
        req.onerror = e => rej(e.target.error);
    });
}
async function idbDeleteByPrefix(prefix) {
    const db = await openIDB();
    return new Promise((res, rej) => {
        const tx = db.transaction('pdfs', 'readwrite');
        const store = tx.objectStore('pdfs');
        store.getAllKeys().onsuccess = e => {
            e.target.result.filter(k => k.startsWith(prefix)).forEach(k => store.delete(k));
        };
        tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
    });
}
async function idbGetAllKeys() {
    const db = await openIDB();
    return new Promise((res, rej) => {
        const tx = db.transaction('pdfs', 'readonly');
        const req = tx.objectStore('pdfs').getAllKeys();
        req.onsuccess = e => res(e.target.result);
        req.onerror = e => rej(e.target.error);
    });
}
async function refreshLocalPdfKeys() {
    try { const keys = await idbGetAllKeys(); localPdfKeys = new Set(keys); } catch(e) { localPdfKeys = new Set(); }
    renderCduContent();
}

// --- ZIP Import ---
function triggerZipImport() {
    document.getElementById('zipFileInput').click();
}

// 압축 해제된 폴더 가져오기 (메모리 절약 — JSZip 미사용)
function triggerFolderImport() {
    // 매번 새 input을 생성해 webkitdirectory를 프로퍼티로 설정
    // (정적 HTML 속성은 일부 브라우저에서 폴더 선택이 열리지 않는 문제가 있음)
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.style.display = 'none';

    // iOS/iPadOS Safari는 webkitdirectory 프로퍼티는 있으나 실제 폴더 선택이
    // 동작하지 않는다(파일 앱에 '열기' 메뉴가 없음). → 다중 파일 선택으로 처리.
    const ua = navigator.userAgent || '';
    const isIOS = /iP(ad|hone|od)/.test(ua) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+
    let folderSupported = false;
    if (!isIOS) {
        try {
            inp.webkitdirectory = true;
            inp.directory = true;
            folderSupported = ('webkitdirectory' in inp);
        } catch(e) { _swallow(e); }
    }

    if (!folderSupported) {
        // 폴더 선택 미지원(iPad/모바일) → 여러 PDF 파일 선택으로 대체
        inp.multiple = true;
        inp.accept = 'application/pdf,.pdf';
        if (isIOS) {
            uiAlert('아이패드/아이폰에서는 폴더 자체를 선택할 수 없습니다.\n\n파일 앱에서 압축을 푼 폴더로 들어간 뒤,\n그 안의 PDF들을 모두 선택해 주세요.\n(전체 선택: 우측 상단 ⋯ → 선택 → 모두 선택)');
        } else {
            uiAlert('이 브라우저는 폴더 선택을 지원하지 않습니다.\n압축을 푼 폴더 안의 PDF 파일들을 직접 여러 개 선택해 주세요.');
        }
    }

    inp.addEventListener('change', () => {
        handleFolderImport(inp);
        if (inp.parentNode) inp.parentNode.removeChild(inp);
    });
    document.body.appendChild(inp);
    inp.click();
}

// 이미 저장된 항목이 macOS AppleDouble(._) 등 오류 메타데이터인지 판별
function _isJunkChart(c) {
    const num = (c.chartNum || '').trim();
    const name = (c.chartName || '').trim();
    return /^\._/.test(num) || /^\._/.test(name) ||
           /^\(\._/.test(num) || /^\(\._/.test(name) ||
           /\._[A-Z0-9-]*-?TEXT/i.test(name);
}

// 파일 경로/이름에서 ICAO·차트번호·차트명 추출 (ZIP/폴더 공용)
// hintIcao: 경로에서 ICAO를 못 찾을 때(iOS 다중 파일 선택 등) 사용할 후보
function _parseChartPath(path, hintIcao) {
    if (!/\.pdf$/i.test(path)) return null;
    const baseName = path.split(/[\/\\]/).pop();
    // macOS 압축 해제 시 생기는 AppleDouble 메타데이터(._파일명, __MACOSX) 제외
    if (/^\._/.test(baseName) || /(^|[\/\\])__MACOSX([\/\\]|$)/.test(path)) return null;
    const fnUpper = baseName.toUpperCase();
    let icao = null, cat;
    const icaoM = path.match(/AD[\/\\]([A-Z]{4})[\/\\]/i);
    if (icaoM) {
        icao = icaoM[1].toUpperCase();
    } else if (/(^|[\/\\])ENR([\/\\]|[\s._-])/i.test(path) || /^\(?\s*ENR\b/.test(fnUpper)) {
        // Enroute(항로) 차트 — 특정 공항에 속하지 않음
        icao = ENROUTE_GROUP; cat = 'ENR';
    } else if (/(^|[\/\\])GEN([\/\\]|[\s._-])/i.test(path) || /^\(?\s*GEN\b/.test(fnUpper)) {
        // General(일반) 섹션 — 특정 공항에 속하지 않음
        icao = GENERAL_GROUP; cat = 'GEN';
    } else {
        // 경로에 폴더 구조가 없으면(iOS 등) 파일명에서 ICAO 토큰 탐색
        const tok = fnUpper.match(/\b([RZ][A-Z]{3})\b/); // 한국/동아시아 ICAO (RK**, ZK**)
        if (tok) icao = tok[1];
        else if (hintIcao) icao = hintIcao.toUpperCase();
        else return null;
    }
    const filename = path.split(/[\/\\]/).pop().replace(/\.pdf$/i, '').trim();
    const pm = filename.match(/^\(([^)]+)\)\s*(.*)/);
    let num, chartName;
    if (pm && pm[2]) { num = pm[1].trim(); chartName = pm[2].trim(); }
    else if (pm)     { num = pm[1].trim(); chartName = filename; }
    else {
        const anyNum = filename.match(/^(\d[\d\-A-Z.]*)\s+(.*)/i);
        if (anyNum)  { num = anyNum[1].trim(); chartName = anyNum[2].trim(); }
        else {
            // ENR 6-1 / GEN 3.2 형태 등: 앞쪽 식별자 토큰을 번호로
            const secNum = filename.match(/^((?:ENR|GEN)[\s\d.\-]*)\s*(.*)/i);
            if (secNum && secNum[2]) { num = secNum[1].trim(); chartName = secNum[2].trim(); }
            else { num = filename.slice(0, 12); chartName = filename; }
        }
    }
    return { icao, num, chartName, cat };
}

function catFromChartName(name) {
    const n = name.toUpperCase();
    if (n.includes('INSTR APCH') || n.includes('VISUAL APCH') || n.includes('ILS') || n.includes('VOR') || n.includes('NDB')) return 'IAP';
    if (n.includes('STAR') || n.includes('ARR')) return 'STAR';
    if (n.includes('SID') || n.includes('AREA CHART_DEP') || n.includes('DEP')) return 'SID';
    return 'AD';
}

function getSafeAiracInfo() {
    const airac = getAiracInfo_charts();
    if (airac.daysLeft >= 26) {
        const ref = new Date(2024, 0, 25);
        const dayMs = 86400000;
        const offset = Math.floor((new Date() - ref) / (28 * dayMs)) - 1;
        const n1 = offset + 1;
        const yr = 2024 + Math.floor((n1 - 1) / 13);
        const cn = ((n1 - 1) % 13) + 1;
        const id = yr.toString().slice(2) + cn.toString().padStart(2, '0');
        const startDate = new Date(ref.getTime() + offset * 28 * dayMs);
        const startUrl = startDate.toISOString().slice(0, 10);
        return { ...airac, id, startUrl };
    }
    return airac;
}

// ── 스트리밍 ZIP 리더 (저메모리) ─────────────────────────────
// ZIP 전체를 메모리에 올리지 않고, 파일을 조각내(file.slice) 중앙
// 디렉터리만 읽은 뒤 각 항목을 필요할 때 1개씩 슬라이스·해제(inflate)한다.
// → 대용량 AIRAC ZIP도 8GB 이하 기기에서 중단 없이 처리.
async function _zipReadSlice(file, start, len) {
    return new Uint8Array(await file.slice(start, start + len).arrayBuffer());
}
async function _streamZipEntries(file) {
    if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream 미지원');
    // ① EOCD(End of Central Directory) 탐색 — 파일 끝 최대 65557바이트
    const tailLen = Math.min(65557, file.size);
    const tail = await _zipReadSlice(file, file.size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i+1] === 0x4b && tail[i+2] === 0x05 && tail[i+3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 중앙 디렉터리를 찾지 못함');
    const tv = new DataView(tail.buffer, tail.byteOffset);
    const cdSize = tv.getUint32(eocd + 12, true);
    const cdOff  = tv.getUint32(eocd + 16, true);
    if (cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) throw new Error('ZIP64 미지원');   // 폴백 유도
    // ② 중앙 디렉터리(작음) 읽어 항목 메타 파싱
    const cd = await _zipReadSlice(file, cdOff, cdSize);
    const cv = new DataView(cd.buffer, cd.byteOffset);
    const dec = new TextDecoder('utf-8');
    const out = [];
    let p = 0;
    while (p + 46 <= cd.length && cv.getUint32(p, true) === 0x02014b50) {
        const method   = cv.getUint16(p + 10, true);
        const compSize = cv.getUint32(p + 20, true);
        const nameLen  = cv.getUint16(p + 28, true);
        const extraLen = cv.getUint16(p + 30, true);
        const cmtLen   = cv.getUint16(p + 32, true);
        const lho      = cv.getUint32(p + 42, true);
        const name     = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
        if (lho !== 0xFFFFFFFF && compSize !== 0xFFFFFFFF && !name.endsWith('/')) {
            out.push({ name, method, compSize, lho });
        }
        p += 46 + nameLen + extraLen + cmtLen;
    }
    return out.map(e => ({
        path: e.name,
        getBuffer: async () => {
            const lh = await _zipReadSlice(file, e.lho, 30);
            const lv = new DataView(lh.buffer, lh.byteOffset);
            const dataStart = e.lho + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
            const comp = await _zipReadSlice(file, dataStart, e.compSize);   // 이 항목만 메모리에
            if (e.method === 0) return comp.buffer;   // stored(무압축)
            const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return await new Response(stream).arrayBuffer();
        }
    }));
}

// ZIP 안의 파일 목록을 읽는다 — 저메모리 스트리밍 리더 우선, 실패하면 JSZip 폴백.
// ZIP 파일 가져오기와 저장소 가져오기가 함께 쓴다.
async function _readZipEntries(blob) {
    try {
        return await _streamZipEntries(blob);
    } catch(streamErr) {
        console.warn('스트리밍 ZIP 실패, JSZip 폴백:', streamErr.message);
        if (typeof JSZip === 'undefined') {
            throw new Error('ZIP 파일을 읽을 수 없습니다.\n(' + streamErr.message + ')');
        }
        let zip;
        try { zip = await JSZip.loadAsync(blob); }
        catch(e) {
            throw new Error('ZIP 파일을 읽을 수 없습니다.\n파일이 손상되었거나 올바른 ZIP 형식이 아닙니다.\n(' + e.message + ')');
        }
        const out = [];
        zip.forEach((path, entry) => { if (!entry.dir) out.push({ path, getBuffer: () => entry.async('arraybuffer') }); });
        return out;
    }
}

async function handleZipFile(file) {
    if (!file) return;

    importProgress = { phase: 'reading', done: 0, total: 0, found: 0, skipped: 0, error: null };
    renderCduContent();

    try {
        const rawEntries = await _readZipEntries(file);   // 실패하면 예외로 던진다

        // 차트 PDF만 필터링(메모리 절약 — blob 추출 X)
        const entries = [];
        rawEntries.forEach(e => {
            const meta = _parseChartPath(e.path);
            if (meta) entries.push({ getBuffer: e.getBuffer, ...meta });
        });

        if (entries.length === 0) {
            importProgress = null;
            renderCduContent();
            uiAlert('ZIP 파일 안에서 차트 PDF를 찾지 못했습니다.\nAIM Korea에서 받은 AIRAC ZIP 파일인지 확인해 주세요.\n(경로: .../AD/ICAO4/(번호) 차트명.pdf)');
            return;
        }

        await _saveChartEntries(entries);

    } catch(e) {
        console.error('ZIP import error:', e);
        uiAlert('ZIP 가져오기 중 오류가 발생했습니다:\n' + e.message);
        importProgress = null;
    }
    await refreshLocalPdfKeys();
}

// 선택한 파일들에서 그룹 공항코드(ICAO) 탐색
// 우선순위: ① 폴더 경로(AD/ICAO/), ② 모든 파일명의 ICAO 토큰, ③ txt 파일 내용
async function _detectGroupIcao(files) {
    // ① 폴더 경로에서
    for (const f of files) {
        const m = (f.webkitRelativePath || '').match(/AD[\/\\]([A-Z]{4})[\/\\]/i);
        if (m) return m[1].toUpperCase();
    }
    // ② 파일명(확장자 무관)에서 한국/동아시아 ICAO 토큰
    for (const f of files) {
        const name = (f.webkitRelativePath || f.name || '').toUpperCase();
        const m = name.match(/\b([RZ][A-Z]{3})\b/);
        if (m) return m[1];
    }
    // ③ txt 등 텍스트 보조 파일 내용에서 ICAO 탐색 (앞부분만 읽음)
    for (const f of files) {
        if (!/\.(txt|csv|json|xml|cfg|ini)$/i.test(f.name)) continue;
        try {
            const slice = f.slice ? f.slice(0, 65536) : f;
            const txt = (await slice.text()).toUpperCase();
            const m = txt.match(/\b([RZ][A-Z]{3})\b/);
            if (m) return m[1];
        } catch(e) { _swallow(e); }
    }
    return null;
}

// 압축 해제된 폴더에서 차트 가져오기 (JSZip 미사용 — 저메모리 기기용)
async function handleFolderImport(input) {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;

    importProgress = { phase: 'reading', done: 0, total: 0, found: 0, skipped: 0, error: null };
    renderCduContent();

    try {
        // 선택한 파일들 중 공항코드 단서 탐색 (txt 등 보조 파일 포함)
        // 1) PDF 외 파일명에서 ICAO 토큰, 2) txt 파일 내용에서 ICAO
        let groupIcao = await _detectGroupIcao(files);

        // 1차 파싱 (경로/파일명에서 ICAO 추출, 없으면 그룹 ICAO 사용)
        const pdfFiles = files.filter(f => /\.pdf$/i.test(f.webkitRelativePath || f.name));
        let entries = [];
        for (const file of pdfFiles) {
            const path = file.webkitRelativePath || file.name;
            const meta = _parseChartPath(path, groupIcao);
            if (meta) entries.push({ getBuffer: () => file.arrayBuffer(), ...meta });
        }

        // 그래도 ICAO를 못 찾았으면 공항코드 입력 요청
        if (entries.length === 0 && pdfFiles.length > 0) {
            const hint = (await uiPrompt(
                'PDF 파일의 공항(ICAO 4코드)을 자동으로 찾지 못했습니다.\n' +
                '선택한 PDF들이 속한 공항코드를 입력해 주세요. (예: RKSI)\n' +
                '※ 한 번에 한 공항 폴더의 파일만 선택해 주세요.', ''
            ) || '').trim().toUpperCase();
            if (/^[A-Z]{4}$/.test(hint)) {
                for (const file of pdfFiles) {
                    const path = file.webkitRelativePath || file.name;
                    const meta = _parseChartPath(path, hint);
                    if (meta) entries.push({ getBuffer: () => file.arrayBuffer(), ...meta });
                }
            }
        }

        if (entries.length === 0) {
            importProgress = null;
            renderCduContent();
            uiAlert('선택한 항목에서 차트 PDF를 인식하지 못했습니다.\n\nPC: ZIP을 푼 상위 폴더를 선택\n아이패드/아이폰: 공항 폴더로 들어가 PDF들을 선택 후 공항코드 입력');
            return;
        }

        await _saveChartEntries(entries);

    } catch(e) {
        console.error('Folder import error:', e);
        uiAlert('폴더 가져오기 중 오류가 발생했습니다:\n' + e.message);
        importProgress = null;
    }
    await refreshLocalPdfKeys();
}

// ZIP/폴더 공용 저장 루프 — entries: [{ getBuffer:async()=>ArrayBuffer, icao, num, chartName }]
async function _saveChartEntries(entries) {
    importProgress = { phase: 'saving', done: 0, total: entries.length, found: 0, skipped: 0, error: null };
    renderCduContent();

    const safeAirac = getSafeAiracInfo();
    const today = new Date().toISOString().slice(0, 10);
    let saved = loadSavedCharts();
    let idbFailed = false;
    // 실패를 숫자로만 알리면 손쓸 방법이 없다. 사유별로 세어 함께 보여준다.
    const failReasons = new Map();
    let firstFailUrl = '';

    // 진행 중 부분 저장(크래시 복구용). 용량 초과 시 최근분만 보존.
    const persistSaved = () => {
        try {
            localStorage.setItem('savedCharts', JSON.stringify(saved));
        } catch(storageErr) {
            console.warn('localStorage 용량 초과, 최근 50개만 보존');
            try { localStorage.setItem('savedCharts', JSON.stringify(saved.slice(-50))); } catch(e2) { _swallow(e2); }
        }
    };

    for (let i = 0; i < entries.length; i++) {
        const { getBuffer, icao, num, chartName, cat } = entries[i];
        try {
            // PDF를 ArrayBuffer로 추출 → IDB 저장 → 즉시 해제
            let buf = await getBuffer();
            let blob = new Blob([buf], { type: 'application/pdf' });
            buf = null; // ArrayBuffer 즉시 해제 → GC 유도

            if (!idbFailed) {
                try {
                    await idbPut(`${icao}|${num}`, blob);
                    importProgress.found++;
                } catch(idbErr) {
                    idbFailed = true;
                    console.warn('IndexedDB 저장 실패:', idbErr.message);
                }
            }
            blob = null; // Blob 참조 즉시 해제 → 저메모리 기기 GC 유도

            const alreadyIn = saved.find(s => s.icao === icao && s.chartNum === num);
            if (!alreadyIn) {
                const section = SECTION_GROUPS[icao];
                const airport = chartAirportList.find(a => a.icao === icao);
                const known = (airportSpecificCharts[icao] || []).find(c => c.num === num);
                saved.push({
                    icao, name: section ? section.name : (airport?.nameEn || icao),
                    chartNum: num, chartName: known?.name || chartName,
                    cat: cat || known?.cat || catFromChartName(chartName),
                    url: section ? '' : buildChartPdfUrl(safeAirac.startUrl, icao, num, known?.name || chartName),
                    airac: safeAirac.id, savedAt: today, status: 'unverified'
                });
            }
        } catch(e) {
            console.warn('항목 처리 실패:', icao, num, e.message);
            const why = e.name === 'AbortError' ? '응답 없음(시간 초과)' : (e.message || String(e));
            failReasons.set(why, (failReasons.get(why) || 0) + 1);
            if (!firstFailUrl) firstFailUrl = `${icao} (${num})`;
            importProgress.skipped++;
        }

        importProgress.done = i + 1;
        // 렌더 빈도 축소(매 8개) → 메인스레드/메모리 부담 감소
        if (i % 8 === 0) renderCduContent();
        // 증분 저장(매 10개) → 도중 리셋돼도 진행분 보존
        if (i % 10 === 9) persistSaved();
        // 매 10개마다 IndexedDB 연결을 닫아 버퍼된 쓰기를 디스크로 flush →
        // WebKit 메모리 회수. 이어서 긴 여유(300ms)로 flush/GC 시간 확보.
        if (i % 10 === 9) {
            idbClose();
            await new Promise(r => setTimeout(r, 300));
        } else {
            await new Promise(r => setTimeout(r, 20));
        }
    }

    // 최종 저장
    persistSaved();
    idbClose();

    // 완료 알림
    const msgs = [];
    if (importProgress.found > 0) msgs.push(`✅ PDF 저장: ${importProgress.found}개`);
    if (idbFailed) msgs.push('⚠️ 일부 PDF는 저장 공간 부족으로 메타데이터만 저장됨\n(차트 목록에서 ↗ 외부 열기 가능)');
    if (importProgress.skipped > 0) {
        msgs.push(`⏭ 받지 못해 건너뜀: ${importProgress.skipped}개`);
        const top = [...failReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        if (top.length) {
            msgs.push('\n— 왜 실패했나 —');
            top.forEach(([why, n]) => msgs.push(`  · ${why} — ${n}개`));
            if (firstFailUrl) msgs.push(`  (처음 실패: ${firstFailUrl})`);
            // 가장 흔한 사유에 맞춰 다음에 할 일을 짚어 준다
            const w = top[0][0];
            if (/429|Too Many/i.test(w)) msgs.push('\n▸ 사이트가 요청 속도를 제한하고 있습니다.\n  잠시 뒤 공항 하나씩 [⤓ 받기] 로 나눠 받아 주세요.');
            else if (/HTTP 5(2[0-9]|0[24])/.test(w)) msgs.push('\n▸ 중계와 사이트 사이가 끊깁니다(522 등).\n  한꺼번에 많이 받으면 사이트가 한동안 막습니다.\n  10~30분 뒤 공항 하나씩 [⤓ 받기] 로 받아 주세요.');
            else if (/40[13]/.test(w)) msgs.push('\n▸ 접근이 거부됐습니다. 중계 코드가 eAIP 주소를 그대로\n  전달하는지 확인해 주세요.');
            else if (/시간 초과|Failed to fetch|Load failed/i.test(w)) msgs.push('\n▸ 연결이 끊깁니다. 통신 상태를 확인하고 공항 하나씩\n  [⤓ 받기] 로 나눠 받아 주세요.');
        }
    }
    if (msgs.length) await uiAlert(msgs.join('\n'));

    importProgress = null;
}

// --- PDF Viewer ---
let _pdfDoc = null, _pdfCurPage = 1;
let _pdfTx = 0, _pdfTy = 0, _pdfScale = 1;
let _pdfOx = 0, _pdfOy = 0;
let _pdfFitScale = 1, _pdfBaseW = 0, _pdfBaseH = 0;   // fit(=1배) 레이아웃
let _pdfRenderQ = 1;          // 현재 비트맵 품질 배율(선명도)
let _pdfRenderToken = 0;      // 렌더 경쟁 방지 토큰
let _pdfReqTimer = null;      // 품질 재렌더 디바운스
let _pdfResizeObs = null;     // CDU 창 크기 변화 감시(Full Screen 전환 대응)
let _pdfResizeT = null;       // 리사이즈 재렌더 디바운스

// ── 차트 위치 보정(다점 최소자승 아핀) + 항공기 위치 오버레이 ──
let _pdfChartKey = null;      // 현재 차트 키 (icao|chartNum)
let _pdfCalibration = null;   // { pts:[{fx,fy,lat,lon,name}], fit:{...} } — fx/fy는 페이지 비율(0~1)
let _pdfCalActive = false;    // 보정 수집 중 여부
let _pdfCalPts = [];          // 보정 수집 중 임시 점 목록
let _pdfAcTimer = null;       // 항공기 위치 갱신 타이머
let _pdfFixList = [];         // 현재 PDF에서 추출한 픽스 목록 [{name,lat,lon}]

function _loadChartCalib(key) {
    try {
        const cal = (JSON.parse(localStorage.getItem('chartCalib') || '{}'))[key] || null;
        if (!cal) return null;
        // 구버전({p1,p2}) 호환 → pts 배열로 변환
        if (!cal.pts && cal.p1 && cal.p2) cal.pts = [cal.p1, cal.p2];
        if (!cal.pts || cal.pts.length < 2) return null;
        cal.fit = _pdfFit(cal.pts);
        return cal;
    } catch(e) { return null; }
}
function _saveChartCalib(key, cal) {
    try {
        const m = JSON.parse(localStorage.getItem('chartCalib') || '{}');
        m[key] = { pts: cal.pts };   // 원자료(점들)만 저장 — fit은 로드 시 재계산
        localStorage.setItem('chartCalib', JSON.stringify(m));
    } catch(e) { _swallow(e); }
}
function _pdfClearCalib() {
    try {
        const m = JSON.parse(localStorage.getItem('chartCalib') || '{}');
        delete m[_pdfChartKey]; localStorage.setItem('chartCalib', JSON.stringify(m));
    } catch(e) { _swallow(e); }
    _pdfCalibration = null; _pdfUpdateAcMarker();
}

// 위/경도 입력 파서 — 십진수(37.46) 또는 DMS(37 27 47 N / N37°27′) 허용
function _parseLatLonInput(s) {
    if (s == null) return null;
    s = ('' + s).trim(); if (!s) return null;
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    const m = s.toUpperCase().match(/([NSEW])?\s*(\d+(?:\.\d+)?)[°\s]*(?:(\d+(?:\.\d+)?)['′\s]*)?(?:(\d+(?:\.\d+)?)["″\s]*)?([NSEW])?/);
    if (!m) return null;
    const hemi = m[1] || m[5];
    let v = parseFloat(m[2]) + (m[3] ? parseFloat(m[3]) / 60 : 0) + (m[4] ? parseFloat(m[4]) / 3600 : 0);
    if (isNaN(v)) return null;
    if (hemi === 'S' || hemi === 'W') v = -v;
    return v;
}

// 3×3 선형계 풀이(가우스 소거)
function _solve3(M, b) {
    const a = [[M[0][0], M[0][1], M[0][2], b[0]],
               [M[1][0], M[1][1], M[1][2], b[1]],
               [M[2][0], M[2][1], M[2][2], b[2]]];
    for (let i = 0; i < 3; i++) {
        let p = i;
        for (let r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
        if (Math.abs(a[p][i]) < 1e-12) return null;
        [a[i], a[p]] = [a[p], a[i]];
        for (let r = 0; r < 3; r++) {
            if (r === i) continue;
            const f = a[r][i] / a[i][i];
            for (let c = i; c < 4; c++) a[r][c] -= f * a[i][c];
        }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

// 차트 보정용 작업 좌표 — 메르카토르(등각 투영).
// 종전에는 x = lon·cos(lat0), y = lat 의 정거원통(equirectangular)을 썼는데,
// 이 좌표계는 위도에 따라 동서 축척이 달라진다(cos(lat) 변화). 차트 범위가
// 위도로 0.5°만 되어도 동서 축척이 약 0.6% 어긋나, 40NM 차트에서 400m대의
// 계통 오차가 생긴다. 그 왜곡을 아핀의 비대칭 축척·전단이 억지로 흡수하면서
// 점이 적을 때 오차가 크게 튀었다.
// 메르카토르는 등각이라 국소적으로 축척이 등방(等方)이므로, 항공차트(LCC·
// 메르카토르 계열)를 회전+균일축척+평행이동(닮음변환)으로 정확히 모델링할 수 있다.
function _pdfGeoXY(lat, lon, lat0) {
    const φ = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
    return { x: lon, y: Math.log(Math.tan(Math.PI / 4 + φ / 2)) * 180 / Math.PI };
}

// 닮음변환(회전·균일축척·평행이동, 4파라미터) 최소자승 — Helmert 변환.
// 점 3개면 방정식 6개 / 미지수 4개라 여유도가 2 → 클릭 오차가 평균되어 걸러진다.
//
// ★ 반전(mirror)을 반드시 함께 본다.
//   PDF 페이지 좌표는 fy 가 아래로 증가하는데 위도는 위로 증가하므로,
//   지리→페이지 변환에는 사실상 항상 거울반전이 들어간다(행렬식 < 0).
//   회전만 모델링하면 보정점 자체는 맞아도 그 밖의 영역이 좌우로 뒤집혀
//   차트 반대편에서 수십 km씩 어긋난다.
//   그래서 정회전/반전 두 가지를 모두 맞춰 보고 잔차가 작은 쪽을 쓴다.
function _pdfFitSimilarity(points, lat0) {
    const n = points.length;
    const toXY = p => _pdfGeoXY(p.lat, p.lon, lat0);
    let mx = 0, my = 0, mfx = 0, mfy = 0;
    points.forEach(p => { const q = toXY(p); mx += q.x; my += q.y; mfx += p.fx; mfy += p.fy; });
    mx /= n; my /= n; mfx /= n; mfy /= n;
    let sxx = 0, n1 = 0, n2 = 0, m1 = 0, m2 = 0;
    points.forEach(p => {
        const q = toXY(p);
        const dx = q.x - mx, dy = q.y - my, dfx = p.fx - mfx, dfy = p.fy - mfy;
        sxx += dx * dx + dy * dy;
        n1 += dx * dfx + dy * dfy;      // 정회전 ra
        n2 += dx * dfy - dy * dfx;      // 정회전 rb
        m1 += dx * dfx - dy * dfy;      // 반전 ra
        m2 += dy * dfx + dx * dfy;      // 반전 rb
    });
    if (sxx < 1e-18) return null;
    const base = { lat0, kind: 'similarity', P1: { x: mx, y: my, fx: mfx, fy: mfy }, n };
    const cand = [
        Object.assign({}, base, { mir: 0, ra: n1 / sxx, rb: n2 / sxx }),
        Object.assign({}, base, { mir: 1, ra: m1 / sxx, rb: m2 / sxx }),
    ];
    cand.forEach(f => { f.rms = _pdfResidRms(f, points); });
    // 보정점이 일직선에 가깝거나 2점뿐이면 두 해의 잔차가 사실상 같아져
    // 반전 판정이 부동소수점 잡음으로 갈린다(2점은 자유도가 같아 둘 다 정확히 맞는다).
    // 페이지 fy 는 아래로, 위도는 위로 증가하므로 반전이 물리적으로 정상 —
    // 반전이 충분히 잘 맞으면 그대로 쓰고, 정회전은 "확실히 더 잘 맞을 때"만 채택한다.
    if (cand[1].rms <= 1e-9) return cand[1];
    return (cand[0].rms < cand[1].rms * 0.5) ? cand[0] : cand[1];
}

// 아핀 최소자승(6파라미터) — 점이 4개 이상일 때만 쓴다.
// 3점이면 방정식이 정확히 6개라 항상 잔차 0으로 "완벽히" 맞지만, 그건 클릭
// 오차까지 그대로 재현한 것일 뿐이라 차트 다른 곳에서 크게 어긋난다.
function _pdfFitAffine(points, lat0) {
    let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0, Sn = 0;
    let bxFx = 0, byFx = 0, bnFx = 0, bxFy = 0, byFy = 0, bnFy = 0;
    points.forEach(p => {
        const { x, y } = _pdfGeoXY(p.lat, p.lon, lat0);
        Sxx += x * x; Sxy += x * y; Sx += x; Syy += y * y; Sy += y; Sn += 1;
        bxFx += x * p.fx; byFx += y * p.fx; bnFx += p.fx;
        bxFy += x * p.fy; byFy += y * p.fy; bnFy += p.fy;
    });
    const M = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, Sn]];
    const abc = _solve3(M, [bxFx, byFx, bnFx]);
    const def = _solve3(M, [bxFy, byFy, bnFy]);
    if (!abc || !def) return null;
    return { lat0, kind: 'affine', abc, def, n: points.length };
}

// 변환식으로 한 점을 페이지비율로 투영
function _pdfApply(f, lat, lon) {
    const { x, y } = _pdfGeoXY(lat, lon, f.lat0);
    if (f.kind === 'affine') {
        return { fx: f.abc[0] * x + f.abc[1] * y + f.abc[2],
                 fy: f.def[0] * x + f.def[1] * y + f.def[2] };
    }
    const dx = x - f.P1.x, dy = y - f.P1.y;
    return f.mir
        ? { fx: f.P1.fx + f.ra * dx + f.rb * dy, fy: f.P1.fy + f.rb * dx - f.ra * dy }
        : { fx: f.P1.fx + f.ra * dx - f.rb * dy, fy: f.P1.fy + f.rb * dx + f.ra * dy };
}
function _pdfResidRms(f, points) {
    let se = 0;
    points.forEach(p => {
        const e = _pdfApply(f, p.lat, p.lon);
        se += (e.fx - p.fx) ** 2 + (e.fy - p.fy) ** 2;
    });
    return Math.sqrt(se / points.length);
}
// leave-one-out 교차검증 — 한 점씩 빼고 맞춘 뒤 뺀 점을 얼마나 맞히는지.
// 3점 아핀처럼 "잔차 0"이 나오는 모델의 실제 정확도를 정직하게 재는 지표.
function _pdfLooRms(points, builder, lat0) {
    // 4점 미만이면 한 점을 빼는 순간 남은 점이 미지수와 같거나 적어져
    // (닮음 4파라미터 ↔ 2점 4방정식) 교차검증 값이 발산한다. 의미 없으므로 생략.
    if (points.length < 4) return null;
    let se = 0, cnt = 0;
    for (let i = 0; i < points.length; i++) {
        const sub = points.filter((_, j) => j !== i);
        const f = builder(sub, lat0);
        if (!f) return null;
        const e = _pdfApply(f, points[i].lat, points[i].lon);
        se += (e.fx - points[i].fx) ** 2 + (e.fy - points[i].fy) ** 2;
        cnt++;
    }
    return cnt ? Math.sqrt(se / cnt) : null;
}

// 보정점들로부터 좌표→페이지비율 변환식 계산
//  2~3점 : 닮음변환(회전·균일축척·평행이동) — 자유도가 낮아 클릭 오차에 강하다
//  4점 이상: 닮음/아핀 중 leave-one-out 교차검증 오차가 작은 쪽을 고른다
//            (차트에 실제 비대칭 축척이 있으면 아핀이, 아니면 닮음이 이긴다)
// 보정점 배치의 '펼침 정도' — 0에 가까울수록 일직선(변환이 불안정).
// 점들의 2차 모멘트 고윳값 비(작은쪽/큰쪽)의 제곱근.
function _pdfSpread(points, lat0) {
    const n = points.length; if (n < 3) return 0;
    let mx = 0, my = 0;
    const q = points.map(p => _pdfGeoXY(p.lat, p.lon, lat0));
    q.forEach(v => { mx += v.x; my += v.y; }); mx /= n; my /= n;
    let a = 0, b = 0, c = 0;
    q.forEach(v => { const dx = v.x - mx, dy = v.y - my; a += dx * dx; b += dx * dy; c += dy * dy; });
    const tr = a + c, det = a * c - b * b;
    const disc = Math.max(0, tr * tr / 4 - det);
    const l1 = tr / 2 + Math.sqrt(disc), l2 = tr / 2 - Math.sqrt(disc);
    return l1 > 1e-18 ? Math.sqrt(Math.max(0, l2) / l1) : 0;
}

function _pdfFit(points) {
    const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
    if (points.length < 2) return null;
    const sim = _pdfFitSimilarity(points, lat0);
    if (points.length < 4) {
        if (!sim) return null;
        sim.rms = _pdfResidRms(sim, points);
        sim.loo = _pdfLooRms(points, _pdfFitSimilarity, lat0);
        sim.spread = _pdfSpread(points, lat0);
        return sim;
    }
    const aff = _pdfFitAffine(points, lat0);
    const simLoo = _pdfLooRms(points, _pdfFitSimilarity, lat0);
    const affLoo = _pdfLooRms(points, _pdfFitAffine, lat0);
    let pick = aff || sim;
    if (aff && sim && simLoo != null && affLoo != null && simLoo <= affLoo) pick = sim;
    if (!pick) return null;
    pick.rms = _pdfResidRms(pick, points);
    pick.loo = (pick.kind === 'affine') ? affLoo : simLoo;
    pick.spread = _pdfSpread(points, lat0);
    return pick;
}

function _pdfLatLonToFrac(lat, lon) {
    const cal = _pdfCalibration; if (!cal || !cal.fit) return null;
    return _pdfApply(cal.fit, lat, lon);
}

// 보정점 중 유난히 어긋난 점 찾기(4점 이상). 한 점을 잘못 찍으면 전체가 끌려간다.
// 잔차가 중앙값의 3배를 넘고 절대값도 의미 있게 클 때만 지목한다.
// 보정점끼리 모순되는지 검사.
// 각 쌍의 축척(지도상 거리 ÷ 페이지상 거리)은 모두 같아야 한다. 한 점의 좌표를
// 잘못 고르면 그 점이 낀 쌍의 축척만 어긋나므로 최대/최소 비가 커진다.
// 3점이면 어긋난 쌍이 둘이라 "누가 범인인지"는 특정할 수 없고 모순 여부만 알 수 있다.
function _pdfScaleCheck(points) {
    if (!points || points.length < 3) return null;
    const v = [];
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        const fd = Math.hypot(points[i].fx - points[j].fx, points[i].fy - points[j].fy);
        const gd = distance(points[i].lat, points[i].lon, points[j].lat, points[j].lon) * 1852;
        if (fd > 0.02 && gd > 50) v.push(gd / fd);      // 너무 가까운 쌍은 잡음이라 제외
    }
    if (v.length < 3) return null;
    v.sort((a, b) => a - b);
    return { ratio: v[v.length - 1] / v[0], med: v[Math.floor(v.length / 2)] };
}

// 잘못 찍은 점 찾기(4점 이상).
// 단순 잔차로는 못 잡는다 — 최소자승이 오차를 모든 점에 고르게 나눠 실어서
// 한 점이 크게 틀려도 개별 잔차는 비슷해진다.
// 진짜 신호는 "그 점을 빼면 나머지가 갑자기 잘 맞는가" 다.
// 점 i 를 뺀 부분집합의 잔차가 다른 경우들보다 뚜렷이 작고, 동시에 뺀 점 i 의
// 예측 오차가 크면 그 점을 잘못 찍은 것으로 본다.
function _pdfWorstPoint(fit, points) {
    if (!points || points.length < 4) return null;
    const lat0 = points.reduce((a, p) => a + p.lat, 0) / points.length;
    const st = [];
    for (let i = 0; i < points.length; i++) {
        const sub = points.filter((_, j) => j !== i);
        const f = _pdfFitSimilarity(sub, lat0);
        if (!f) return null;
        const e = _pdfApply(f, points[i].lat, points[i].lon);
        st.push({ i, sub: f.rms, loo: Math.hypot(e.fx - points[i].fx, e.fy - points[i].fy),
                  name: points[i].name });
    }
    const med = st.map(r => r.sub).slice().sort((a, b) => a - b)[Math.floor(st.length / 2)] || 0;
    const best = st.reduce((a, b) => (b.sub < a.sub ? b : a));
    if (med <= 1e-9) return null;                  // 전부 잘 맞음
    if (best.sub > med * 0.34) return null;        // 특별히 튀는 점 없음
    if (best.loo < 0.01) return null;              // 페이지 1% 미만이면 무시
    return { label: best.name || `${best.i + 1}번`, d: best.loo };
}

// 보정 RMS 잔차를 미터로 근사 (가장 멀리 떨어진 두 점의 지리거리/비율거리 사용)
function _pdfCalibRmsMeters(pts, rmsFrac) {
    if (!pts || pts.length < 2 || !rmsFrac) return null;
    let best = 0, mpp = null;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const fd = Math.hypot(pts[i].fx - pts[j].fx, pts[i].fy - pts[j].fy);
        if (fd > best) {
            best = fd;
            const gd = distance(pts[i].lat, pts[i].lon, pts[j].lat, pts[j].lon) * 1852; // NM→m
            mpp = fd > 0 ? gd / fd : null;
        }
    }
    return mpp ? rmsFrac * mpp : null;
}

// 이름 오인식을 막기 위한 불용어(약어/단위/제목 등)
const _PDF_FIX_STOP = new Set([
    'STATION','CHART','APPROACH','INSTRUMENT','APPROACHES','ELEV','ELEVATION','ALT','ALTITUDE',
    'VAR','BRG','DIST','HOLDING','EMERG','EMERGENCY','MAX','MIN','MNM','RVR','VIS','CAT','APCH',
    'MSA','IAF','FAF','MAPT','RWY','RUNWAY','AIP','KOREA','REPUBLIC','TRANS','LEVEL','FEET',
    'INBD','OUTBD','TRACK','COURSE','RADIAL','ARC','THR','THRESHOLD','MISSED','CLIMB','TURN',
    'NORTH','SOUTH','EAST','WEST','AND','THE','FOR','WITH','FROM','NOTE','WARNING','CAUTION',
    // 좌표표(WGS-84 테이블) 헤더/열 이름
    'WPT','FIX','NAME','POINT','LAT','LATN','LONG','LON','WGS','IDENT','TYPE','REMARK','REMARKS',
    'SEQ','GEO','COORD','COORDS','DEG','MIN','SEC','FT','NM','MSL','AMSL','AGL','MHZ','KHZ','CH','FREQ',
    // 영문 문장 전치사/짧은 단어(이름 오인 방지)
    'TO','AT','ON','OR','BY','NO','OF','IN','IF','UNABLE','THEN','UNTIL','ABOVE','BELOW',
    // 관제기관/통신 약어
    'APP','DEP','TWR','GND','CTR','ATIS','CTAF','FREQ','CONTACT'
]);

// PDF 텍스트 조각들을 시각적 '행(row)'으로 재구성
//  pdf.js 텍스트 아이템의 transform에서 x(=t[4]), y(=t[5])를 얻어
//  같은 y(허용오차 내)끼리 묶고 x 순으로 정렬 → 표의 실제 행을 복원
function _pdfPageRows(tc) {
    const items = [];
    for (const it of tc.items) {
        const s = (it.str || '').trim();
        if (!s) continue;
        const t = it.transform || [1,0,0,1,0,0];
        const h = Math.abs(t[3]) || Math.abs(t[0]) || 8;   // 글자 높이(행 병합 허용오차 기준)
        items.push({ s: s.toUpperCase(), x: t[4], y: t[5], h });
    }
    // y 내림차순(페이지 위→아래) 정렬 후 같은 행끼리 묶기
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
        const tol = Math.max(3, it.h * 0.6);
        const row = rows.length ? rows[rows.length - 1] : null;
        if (row && Math.abs(row.y - it.y) <= tol) {
            row.items.push(it);
            row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length; // 평균 y 유지
        } else {
            rows.push({ y: it.y, items: [it] });
        }
    }
    rows.forEach(r => {
        r.items.sort((a, b) => a.x - b.x);
        r.text = r.items.map(i => i.s).join(' ');
    });
    return rows;
}

// ── 위도/경도 토큰 스캐너 ──────────────────────────────
// 지원 표기(접미형·접두형 모두):
//   컴팩트: 355032.0N / N355032.0        구분자: 35°50'32.0"N / 35 50 32.0 N / 35-50-32.0N
//   도분:   3550.53N                      접두 구분자: N35°50'32.0"
function _pdfScanCoordTokens(T, isLon) {
    const H = isLon ? '[EW]' : '[NS]';
    const degLen = isLon ? 3 : 2;
    const dmsLen = isLon ? 7 : 6;         // 컴팩트 DDDMMSS / DDMMSS
    const dmLen  = isLon ? 5 : 4;         // 도분 DDDMM.m / DDMM.m
    const found = [];
    const push = (start, end, hemi, deg, mn, sc) => {
        if (mn >= 60 || sc >= 60) return;
        if (!isLon && deg > 90) return;
        if (isLon && deg > 180) return;
        let v = deg + mn / 60 + sc / 3600;
        if (hemi === 'S' || hemi === 'W') v = -v;
        found.push({ v, start, end });
    };
    let m, re;
    // ── 반구문자를 어느 좌표의 것으로 볼지가 이 함수의 핵심 ──
    // 접미형에서 반구문자 뒤에 숫자가 바로 오면 그건 "다음 좌표의 접두문자"일 수
    // 있다. 단 `375944N1284412E` 처럼 붙여 쓴 좌표쌍이면 진짜 접미문자다.
    // → 뒤가 숫자가 아니거나, 반대쪽 좌표 모양이 이어질 때만 접미로 인정한다.
    const OPP = isLon ? '\\d{6}(?:\\.\\d+)?[NS]' : '\\d{7}(?:\\.\\d+)?[EW]';
    const SUF = '(' + H + ')(?=$|[^\\d]|' + OPP + ')';
    // 공백을 사이에 둔 접미형용 — 반구문자 뒤 공백까지 건너뛰고 같은 판단을 한다
    const OPPS = isLon ? '\\d{6}(?:\\.\\d+)?\\s*[NS]' : '\\d{7}(?:\\.\\d+)?\\s*[EW]';
    // 주의: [^\\d] 만 쓰면 \\s* 가 0개 매칭될 때 공백 자체가 '비숫자'로 인정되어
    // `37°59'44" E 128°44'12"` 의 E 를 앞 숫자의 접미문자로 잘못 붙인다.
    // 공백을 모두 건너뛴 다음 글자가 공백도 숫자도 아닐 때만 접미로 본다.
    const SUFSP = '(' + H + ')(?=\\s*$|\\s*[^\\s\\d]|\\s*' + OPPS + ')';
    // 접두형에서는 반대로, 반구문자가 "앞 좌표의 꼬리"이면 안 된다.
    // 예) `128°44'12"E 38°03'48"N` 에서 경도를 찾을 때 앞 경도의 끝 E 를 집어
    //     뒤 위도 숫자와 짝지으면 38°E 라는 엉뚱한 경도가 만들어진다.
    const PRE = '(^|[^\\d"″\'′.])';

    // ① 컴팩트 접미형: DDMMSS(.s)H — 붙여쓴 경우
    re = new RegExp('(\\d{' + dmsLen + '}(?:\\.\\d+)?)' + SUF, 'g');
    while ((m = re.exec(T)) !== null)
        push(m.index, re.lastIndex, m[2], +m[1].slice(0, degLen), +m[1].slice(degLen, degLen + 2), +m[1].slice(degLen + 2));
    // ①b 컴팩트 접미형(공백 있음) — 뒤에 숫자가 오면 접두문자이므로 제외
    re = new RegExp('(\\d{' + dmsLen + '}(?:\\.\\d+)?)\\s+' + SUFSP, 'g');
    while ((m = re.exec(T)) !== null)
        push(m.index, re.lastIndex, m[2], +m[1].slice(0, degLen), +m[1].slice(degLen, degLen + 2), +m[1].slice(degLen + 2));

    // ② 컴팩트 접두형: HDDMMSS(.s)
    re = new RegExp(PRE + '(' + H + ')\\s*(\\d{' + dmsLen + '}(?:\\.\\d+)?)(?!\\d)', 'g');
    while ((m = re.exec(T)) !== null)
        push(m.index + m[1].length, re.lastIndex, m[2], +m[3].slice(0, degLen), +m[3].slice(degLen, degLen + 2), +m[3].slice(degLen + 2));

    // ③ 구분자 접미형: DD°MM'SS(.s)"H (반구문자가 바로 붙은 경우)
    re = new RegExp('(\\d{1,' + degLen + '})[°\\s-]+(\\d{2})[\'′\\s-]+(\\d{2}(?:\\.\\d+)?)["″]*' + SUF, 'g');
    while ((m = re.exec(T)) !== null)
        push(m.index, re.lastIndex, m[4], +m[1], +m[2], +m[3]);
    // ③b 구분자 접미형(공백으로 떨어진 경우) — 뒤에 숫자가 오면 접두문자이므로 제외
    re = new RegExp('(\\d{1,' + degLen + '})[°\\s-]+(\\d{2})[\'′\\s-]+(\\d{2}(?:\\.\\d+)?)["″]?\\s+' + SUFSP, 'g');
    while ((m = re.exec(T)) !== null)
        push(m.index, re.lastIndex, m[4], +m[1], +m[2], +m[3]);

    // ④ 구분자 접두형: H DD°MM'SS(.s)"
    re = new RegExp(PRE + '(' + H + ')\\s*(\\d{1,' + degLen + '})[°\\s-]+(\\d{2})[\'′\\s-]+(\\d{2}(?:\\.\\d+)?)["″]?', 'g');
    while ((m = re.exec(T)) !== null)
        push(m.index + m[1].length, re.lastIndex, m[2], +m[3], +m[4], +m[5]);

    // ⑤ 도분형: DDMM.mH / HDDMM.m
    re = new RegExp('(\\d{' + dmLen + '}\\.\\d+)\\s*' + SUF, 'g');
    while ((m = re.exec(T)) !== null)
        push(m.index, re.lastIndex, m[2], Math.floor(+m[1] / 100), (+m[1]) % 100, 0);
    re = new RegExp(PRE + '(' + H + ')\\s*(\\d{' + dmLen + '}\\.\\d+)(?!\\d)', 'g');
    while ((m = re.exec(T)) !== null)
        push(m.index + m[1].length, re.lastIndex, m[2], Math.floor(+m[3] / 100), (+m[3]) % 100, 0);

    // 위치순 정렬 + 겹치는 매치 제거(같은 숫자를 여러 패턴이 잡는 경우)
    found.sort((a, b) => (a.start - b.start) || (a.end - b.end));
    const out = [];
    for (const f of found) {
        if (out.length && f.start < out[out.length - 1].end) continue;
        out.push(f);
    }
    return out;
}
function _pdfRowCoords(T) {
    const lats = _pdfScanCoordTokens(T, false);
    const lons = _pdfScanCoordTokens(T, true);
    const out = [];
    let li = 0;
    for (const la of lats) {
        while (li < lons.length && lons[li].end <= la.start) li++;   // 위도보다 앞의 경도는 건너뜀
        if (li >= lons.length) break;
        out.push({ lat: la.v, lon: lons[li].v, start: la.start });
        li++;
    }
    return out;
}

// 한 행에서 포인트 이름·종류 추출 (좌표 앞부분 토큰 우선 = 표의 이름 열)
function _pdfRowNameType(T, coordStart) {
    const before = T.slice(0, coordStart);
    // 이름 후보: 2~5자 대문자 토큰(불용어 제외). 표에서는 맨 왼쪽 열이 포인트명이므로
    // '좌표 앞 구간에서 가장 마지막이 아니라 첫 번째' 유효 토큰을 우선한다.
    const toks = before.match(/\b[A-Z]{2,5}\b/g) || [];
    let nm = '';
    for (const t of toks) { if (!_PDF_FIX_STOP.has(t) && t.length >= 3) { nm = t; break; } }
    // 없으면 2자(항법시설 IDENT 등)도 허용
    if (!nm) for (const t of toks) { if (!_PDF_FIX_STOP.has(t)) { nm = t; break; } }

    // 행에 표기된 DME 거리 추출: '12.5 DME' / 'DME 12.5' / 'D12.5'
    // (단, 'KUZ DME'처럼 시설명 뒤의 DME는 거리 아님 → 숫자 동반 시에만)
    let dme = '';
    // DME 뒤 숫자는 소수점 필수(좌표 도分 숫자 오인 방지: 'VOR/DME 35 54…')
    let dm = T.match(/\b(\d{1,3}(?:\.\d+)?)\s*DME\b/) || T.match(/\bDME\s*(\d{1,3}\.\d+)\b/) || T.match(/\bD(\d{1,3}\.\d+)\b/);
    if (dm) dme = dm[1];

    // 접근절차 핵심 픽스(IAF/FAF/IF)와 항법시설(VOR/DME 등)을 최우선 추출
    if (/\bFAF\b/.test(T)) return { name: nm, type: 'FAF', priority: 3, dme };
    if (/\bIAF\b/.test(T)) return { name: nm, type: 'IAF', priority: 3, dme };
    // IF(중간픽스): (IF), IF/, /IF 라벨은 항상 인정.
    // 단독 IF는 영문 문장("IF UNABLE" 등)과 혼동되므로 짧은 표 행에서만 인정
    const alphaWords = (T.match(/\b[A-Z]{2,}\b/g) || []).length;
    if (/\(IF\)|\bIF\s*\/|\/\s*IF\b/.test(T) || (alphaWords <= 4 && /(^|\s)IF(\s|$)/.test(T)))
        return { name: nm, type: 'IF', priority: 3, dme };
    const nav = T.match(/\b([A-Z]{2,4})\s+(VORTAC|VOR\/DME|VOR|DME|TACAN|NDB)\b/);
    if (nav && !_PDF_FIX_STOP.has(nav[1])) return { name: nav[1], type: nav[2] === 'VOR/DME' ? 'VOR/DME' : nav[2], priority: 3, dme };
    if (/\b(WPT|WAYPOINT|FIX)\b/.test(T) && nm) return { name: nm, type: '', priority: 2, dme };
    if (nm) return { name: nm, type: '', priority: 1, dme };
    return { name: '', type: '', priority: 0, dme };
}

// PDF 전체 페이지에서 픽스(이름+좌표) 자동 추출 — 행(표) 기반
let _pdfNoTextLayer = false;   // 스캔본(텍스트 레이어 없음) 감지 플래그
async function _pdfExtractFixes() {
    _pdfFixList = [];
    _pdfNoTextLayer = false;
    if (!_pdfDoc) return;
    const seen = new Set();
    let totalChars = 0;
    for (let pg = 1; pg <= _pdfDoc.numPages; pg++) {
        let rows;
        try {
            const p = await _pdfDoc.getPage(pg);
            rows = _pdfPageRows(await p.getTextContent());
        } catch(e) { continue; }
        rows.forEach(r => { totalChars += r.text.length; });
        for (let ri = 0; ri < rows.length; ri++) {
            const T = rows[ri].text;
            let coords = _pdfRowCoords(T);
            // 위도만 있고 경도가 없는 행(셀 세로 배치): 다음 행에서 경도를 찾아 짝짓기
            if (coords.length === 0 && ri + 1 < rows.length) {
                const lats = _pdfScanCoordTokens(T, false);
                if (lats.length && _pdfScanCoordTokens(T, true).length === 0) {
                    const lonsNext = _pdfScanCoordTokens(rows[ri + 1].text, true);
                    coords = lats.slice(0, lonsNext.length)
                        .map((la, i) => ({ lat: la.v, lon: lonsNext[i].v, start: la.start }));
                }
            }
            for (const c of coords) {
                let info = _pdfRowNameType(T, c.start);
                // 셀 줄바꿈 등으로 이름이 윗행에 있는 경우: 윗행에서 이름만 보충
                if (!info.name && ri > 0) {
                    const up = _pdfRowNameType(rows[ri - 1].text, rows[ri - 1].text.length);
                    if (up.name) info = { name: up.name, type: info.type || up.type, priority: Math.max(info.priority, up.priority, 1) };
                }
                _pdfAddFix(info, c.lat, c.lon, seen);
            }
        }
    }
    // 텍스트가 거의 없으면 스캔 이미지 PDF로 판단(자동 추출 불가 안내용)
    if (totalChars < 40) _pdfNoTextLayer = true;
    _pdfPruneFixes();
    // IAF/FAF → 항법시설/WPT표 → 명명픽스 → 무명 순 정렬(매칭 편의)
    _pdfFixList.sort((a, b) => (b.priority - a.priority) || ((b.named ? 1 : 0) - (a.named ? 1 : 0)) || a.name.localeCompare(b.name));
}

// 추출 결과 정제 — 차트 한 장에 실린 픽스들은 서로 가까이 모여 있다.
// 표를 세로로 읽거나 정규식이 엉뚱한 숫자를 물면 경도가 위도값으로 잘못
// 읽히는 등의 좌표가 섞이는데(예: 38°03'48"N 38°03'48"E), 그런 점 하나가
// 보정 목록에 남아 선택되면 전체 매핑이 망가진다. 여기서 미리 걸러낸다.
const _PDF_FIX_MAX_NM = 300;   // 기준점에서 이만큼 넘게 떨어지면 오인식으로 본다
function _pdfPruneFixes() {
    if (_pdfFixList.length < 2) return;
    // 기준점: 차트 ICAO 의 공항 위치를 우선 사용, 없으면 좌표 중앙값
    let cLat = null, cLon = null;
    try {
        const icao = (_pdfChartKey || '').split('|')[0];
        const ap = (typeof APT_LATLNG !== 'undefined') ? APT_LATLNG[icao] : null;
        if (ap) { cLat = ap[0]; cLon = ap[1]; }
    } catch(e) { _swallow(e); }
    if (cLat === null) {
        const med = arr => { const v = arr.slice().sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
        cLat = med(_pdfFixList.map(f => f.lat));
        cLon = med(_pdfFixList.map(f => f.lon));
    }
    const keep = _pdfFixList.filter(f => distance(f.lat, f.lon, cLat, cLon) <= _PDF_FIX_MAX_NM);
    // 전부 걸러지면(기준점이 잘못된 경우) 원본을 유지한다
    if (keep.length >= 2 && keep.length < _pdfFixList.length) {
        _pdfFixDropped = _pdfFixList.length - keep.length;
        _pdfFixList = keep;
    } else _pdfFixDropped = 0;
}
let _pdfFixDropped = 0;
function _pdfAddFix(info, lat, lon, seen) {
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
    const nm = (info.name && /^[A-Z]{2,5}$/.test(info.name)) ? info.name : '';
    // 같은 좌표가 먼저 등록됐다면, 더 나은 정보(이름/우선순위)로 갱신
    const ck = lat.toFixed(4) + ',' + lon.toFixed(4);
    if (seen.has(ck)) {
        const ex = _pdfFixList.find(f => (f.lat.toFixed(4) + ',' + f.lon.toFixed(4)) === ck);
        if (ex && info.priority > (ex.priority || 0)) {
            if (nm) { ex.name = nm; ex.named = true; }
            ex.type = info.type || ex.type; ex.priority = info.priority;
            ex.dme = info.dme || ex.dme;
        }
        return;
    }
    seen.add(ck);
    _pdfFixList.push({ name: nm || `좌표${_pdfFixList.length + 1}`, lat, lon, named: !!nm, type: info.type || '', priority: info.priority || 0, dme: info.dme || '' });
}

// 차트 위 항공기 심볼 갱신 (현재 위치 S.lat/lon, 방향 S.hdg)
function _pdfUpdateAcMarker() {
    const area = document.getElementById('pdfViewArea'); if (!area) return;
    let m = document.getElementById('pdfAcMarker');
    if (!_pdfCalibration || typeof S === 'undefined' || S.lat == null) { if (m) m.style.display = 'none'; return; }
    const f = _pdfLatLonToFrac(S.lat, S.lon); if (!f) { if (m) m.style.display = 'none'; return; }
    const fitX = f.fx * _pdfBaseW, fitY = f.fy * _pdfBaseH;
    const sx = _pdfOx + _pdfTx + fitX * _pdfScale;
    const sy = _pdfOy + _pdfTy + fitY * _pdfScale;
    if (!m) {
        m = document.createElement('div');
        m.id = 'pdfAcMarker';
        m.style.cssText = 'position:absolute;pointer-events:none;z-index:6;width:0;height:0;';
        m.innerHTML = '<svg width="36" height="36" viewBox="0 0 36 36" style="position:absolute;left:-18px;top:-18px;transform-origin:18px 18px;"><polygon points="18,3 28,31 18,24 8,31" fill="#ff1744" stroke="#fff" stroke-width="1.6"/></svg>';
        area.appendChild(m);
    }
    m.style.display = 'block';
    m.style.left = sx + 'px';
    m.style.top  = sy + 'px';
    const svg = m.firstChild;
    if (svg) svg.style.transform = `rotate(${S.hdg || 0}deg)`;
}

// 보정 시작/재보정/삭제 토글
async function _pdfToggleCalibration() {
    if (_pdfCalActive) { _pdfCancelCalibration(); return; }
    if (_pdfCalibration) {
        if (await uiConfirm('이 차트는 이미 위치 보정되어 있습니다.',
              { okText: '다시 보정', cancelText: '보정 삭제' })) _pdfStartCalibration();
        else _pdfClearCalib();
    } else {
        _pdfStartCalibration();
    }
}
function _pdfStartCalibration() {
    if (!_pdfChartKey) return;
    _pdfCalActive = true;
    _pdfCalPts = [];
    _pdfShowCalOverlay();
    const hint = _pdfFixList.length
        ? `픽스 좌표 ${_pdfFixList.length}개 자동 인식됨.` +
          (_pdfFixDropped ? ` (오인식 ${_pdfFixDropped}개 제외)` : '') +
          `\n차트에서 픽스를 탭한 뒤 이름을 고르세요.`
        : (_pdfNoTextLayer
            ? `이 PDF는 스캔 이미지라 텍스트가 없어\n좌표 자동 추출이 불가합니다. [직접 입력]을 사용하세요.`
            : `좌표를 아는 지점을 탭한 뒤 좌표를 입력하세요.\n(이 차트에서 픽스 좌표를 못 찾았습니다)`);
    _pdfCalBanner(`위치 보정 · 3점 이상 권장\n${hint}`);
}
function _pdfCancelCalibration() {
    _pdfCalActive = false; _pdfCalPts = [];
    const o = document.getElementById('pdfCalOverlay'); if (o) o.remove();
    const pk = document.getElementById('pdfFixPicker'); if (pk) pk.remove();
}
function _pdfCalBanner(msg) {
    const b = document.getElementById('pdfCalBannerTxt');
    if (b) b.innerHTML = msg.replace(/\n/g, '<br>');
}
function _pdfShowCalOverlay() {
    const area = document.getElementById('pdfViewArea'); if (!area) return;
    let o = document.getElementById('pdfCalOverlay'); if (o) o.remove();
    o = document.createElement('div');
    o.id = 'pdfCalOverlay';
    o.style.cssText = 'position:absolute;inset:0;z-index:8;cursor:crosshair;touch-action:none;';
    o.innerHTML = `
        <div id="pdfCalBar" style="position:absolute;top:8px;left:8px;right:8px;background:rgba(0,0,0,0.88);color:#0ff;font-size:11px;padding:8px 10px;border:1px solid #0ff;border-radius:6px;text-align:center;line-height:1.5;">
            <div id="pdfCalBannerTxt"></div>
            <div style="margin-top:7px;display:flex;gap:8px;justify-content:center;">
                <span id="pdfCalUndoBtn" style="color:#ffca28;border:1px solid #ffca28;border-radius:4px;padding:5px 12px;cursor:pointer;">↶ 취소(점)</span>
                <span id="pdfCalDoneBtn" style="color:#00e676;border:1px solid #00e676;border-radius:4px;padding:5px 16px;cursor:pointer;font-weight:bold;">✔ 완료</span>
                <span id="pdfCalExitBtn" style="color:#ff5252;border:1px solid #ff5252;border-radius:4px;padding:5px 12px;cursor:pointer;">✕ 종료</span>
            </div>
        </div>`;
    area.appendChild(o);
    // 버튼은 pointerup으로 직접 처리(유령 클릭·캡처 문제 회피)
    const bind = (id, fn) => {
        const el = o.querySelector('#' + id);
        if (el) el.addEventListener('pointerup', e => { e.stopPropagation(); e.preventDefault(); fn(); });
    };
    bind('pdfCalUndoBtn', _pdfCalUndo);
    bind('pdfCalDoneBtn', _pdfCalFinish);
    bind('pdfCalExitBtn', _pdfCancelCalibration);

    let st = null, moved = false;
    o.addEventListener('pointerdown', e => {
        if (e.target.closest('#pdfCalBar')) return;   // 상단 바(버튼) 탭은 무시
        st = { x: e.clientX, y: e.clientY, tx: _pdfTx, ty: _pdfTy }; moved = false;
    });
    o.addEventListener('pointermove', e => {
        if (!st) return;
        const dx = e.clientX - st.x, dy = e.clientY - st.y;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
        if (moved) { _pdfTx = st.tx + dx; _pdfTy = st.ty + dy; _pdfApplyTransform(); }
    });
    o.addEventListener('pointerup', e => {
        if (e.target.closest('#pdfCalBar')) { st = null; return; }
        const wasTap = st && !moved; const wasMove = moved; st = null;
        if (wasTap) _pdfCalCapture(e);
        else if (wasMove) { _pdfScheduleQuality(); _pdfDrawCalDots(); }
    });
}

// 보정 중 찍은 점들을 오버레이에 작은 원으로 표시
function _pdfDrawCalDots() {
    const o = document.getElementById('pdfCalOverlay'); if (!o) return;
    o.querySelectorAll('.pdfCalDot').forEach(d => d.remove());
    _pdfCalPts.forEach((p, i) => {
        const sx = _pdfOx + _pdfTx + (p.fx * _pdfBaseW) * _pdfScale;
        const sy = _pdfOy + _pdfTy + (p.fy * _pdfBaseH) * _pdfScale;
        const d = document.createElement('div');
        d.className = 'pdfCalDot';
        d.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;width:0;height:0;pointer-events:none;`;
        d.innerHTML = `<div style="position:absolute;left:-6px;top:-6px;width:12px;height:12px;border-radius:50%;background:#00e676;border:2px solid #fff;box-shadow:0 0 3px #000;"></div><div style="position:absolute;left:9px;top:-8px;color:#00e676;font-size:10px;font-weight:bold;text-shadow:0 0 3px #000;">${i + 1}</div>`;
        o.appendChild(d);
    });
}

function _pdfCalUndo() {
    if (!_pdfCalPts.length) return;
    _pdfCalPts.pop();
    _pdfDrawCalDots();
    _pdfCalUpdateBanner();
}
function _pdfCalUpdateBanner() {
    let msg = `위치 보정 · ${_pdfCalPts.length}점 등록`;
    if (_pdfCalPts.length >= 2) {
        const fit = _pdfFit(_pdfCalPts);
        // 4점 이상이면 교차검증(loo), 그 미만이면 보정점 잔차를 보여준다.
        const rm = _pdfCalibRmsMeters(_pdfCalPts, fit.loo != null ? fit.loo : fit.rms);
        msg += ` · ${fit.kind === 'affine' ? '아핀' : '닮음'}`;
        if (rm != null) msg += `(${fit.loo != null ? '예상오차' : '잔차'} ≈ ${Math.round(rm)}m)`;
        // 보정점이 일직선에 가까우면 변환이 불안정해진다 — 삼각형이 되게 유도
        const bad = _pdfWorstPoint(fit, _pdfCalPts);
        const sc = _pdfScaleCheck(_pdfCalPts);
        if (bad)
            msg += `\n⚠ ${bad.label} 점이 많이 어긋납니다 — 지우고 다시 찍으세요`;
        else if (sc && sc.ratio > 1.25)
            msg += `\n⚠ 보정점끼리 맞지 않습니다(축척 ${sc.ratio.toFixed(2)}배 차이)` +
                   `\n  좌표를 잘못 고른 점이 있습니다 — 한 점 더 찍으면 범인을 찾아줍니다`;
        else if (fit.spread != null && fit.spread < 0.12 && _pdfCalPts.length >= 3)
            msg += `\n⚠ 점들이 일직선에 가깝습니다 — 삼각형이 되도록 찍으세요`;
        else msg += `\n점을 더 찍을수록 정확 · [✔ 완료]로 종료`;
    } else {
        msg += `\n픽스를 탭하고 이름을 선택하세요(3점 이상 권장)`;
    }
    _pdfCalBanner(msg);
}

function _pdfCalCapture(e) {
    const area = document.getElementById('pdfViewArea'); if (!area) return;
    const rc = area.getBoundingClientRect();
    const sx = e.clientX - rc.left, sy = e.clientY - rc.top;
    const fx = ((sx - _pdfOx - _pdfTx) / _pdfScale) / _pdfBaseW;
    const fy = ((sy - _pdfOy - _pdfTy) / _pdfScale) / _pdfBaseH;
    // 좌표 선택(추출된 픽스 목록) → 없으면 수동 입력
    _pdfPickCoord(coord => {
        if (!coord) return;
        _pdfCalPts.push({ fx, fy, lat: coord.lat, lon: coord.lon, name: coord.name || '' });
        _pdfDrawCalDots();
        _pdfCalUpdateBanner();
    });
}

// 좌표 선택 모달: 추출된 픽스 목록 + 수동 입력
function _pdfPickCoord(cb) {
    const area = document.getElementById('pdfViewArea'); if (!area) return;
    const ex = document.getElementById('pdfFixPicker'); if (ex) ex.remove();
    const box = document.createElement('div');
    box.id = 'pdfFixPicker';
    box.style.cssText = 'position:absolute;inset:0;z-index:10;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;';
    let listHtml = '';
    _pdfFixList.forEach((f, i) => {
        const isProc = f.type === 'IAF' || f.type === 'FAF' || f.type === 'IF';
        const nameCol = isProc ? '#00e676' : (f.priority >= 2 ? '#26c6da' : (f.named ? '#00e5ff' : '#888'));
        const tagCol  = isProc ? '#00e676' : '#ffca28';
        const tagTxt = [f.type, f.dme ? `D${f.dme}` : ''].filter(Boolean).join(' · ');
        const tag = tagTxt ? ` <span style="color:${tagCol};font-size:9px;font-weight:bold;">${tagTxt}</span>` : '';
        const nameTxt = f.named ? f.name : `· ${f.name}`;
        const dms = `${decToDMS(f.lat, true)} ${decToDMS(f.lon, false)}`;
        listHtml += `<div data-i="${i}" class="pdfFixRow" style="padding:11px 12px;border-bottom:1px solid #222;cursor:pointer;color:#eee;font-size:12px;display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <span style="color:${nameCol};font-weight:bold;">${nameTxt}${tag}</span>
            <span style="color:#aaa;font-size:9px;white-space:nowrap;">${dms}</span></div>`;
    });
    box.innerHTML = `
        <div style="width:86%;max-width:340px;max-height:80%;background:#0c0c0c;border:1px solid #00e5ff;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
            <div style="padding:9px 12px;background:#001a20;color:#00e5ff;font-size:12px;font-weight:bold;flex-shrink:0;">이 지점의 좌표 선택 <span style="color:#00e676;font-size:9px;">■ IAF/FAF/IF</span> <span style="color:#26c6da;font-size:9px;">■ VOR/DME</span></div>
            <div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain;">${listHtml || '<div style="padding:14px;color:#888;font-size:11px;text-align:center;">자동 인식된 픽스가 없습니다.<br>아래 [직접 입력]을 사용하세요.</div>'}</div>
            <div style="display:flex;border-top:1px solid #222;flex-shrink:0;">
                <div id="pdfFixManual" style="flex:1;padding:12px;text-align:center;color:#ffca28;font-size:12px;cursor:pointer;border-right:1px solid #222;">✎ 직접 입력</div>
                <div id="pdfFixCancel" style="flex:1;padding:12px;text-align:center;color:#ff5252;font-size:12px;cursor:pointer;">취소</div>
            </div>
        </div>`;
    area.appendChild(box);
    _pdfMD = null;   // 피커 열림 → 진행 중이던 차트 드래그 상태 해제
    // 유령 클릭 회피를 위해 click 대신 pointerup 사용 + 스크롤 드래그는 선택 제외
    let downY = null, moved = false;
    box.addEventListener('pointerdown', e => { downY = e.clientY; moved = false; });
    box.addEventListener('pointermove', e => { if (downY != null && Math.abs(e.clientY - downY) > 10) moved = true; });
    const pick = (row) => {
        if (moved) return;
        const f = _pdfFixList[+row.getAttribute('data-i')];
        box.remove(); cb({ lat: f.lat, lon: f.lon, name: f.name });
    };
    box.querySelectorAll('.pdfFixRow').forEach(row => {
        row.addEventListener('pointerup', e => { e.stopPropagation(); pick(row); });
    });
    box.querySelector('#pdfFixCancel').addEventListener('pointerup', e => { e.stopPropagation(); box.remove(); cb(null); });
    box.querySelector('#pdfFixManual').addEventListener('pointerup', async e => {
        e.stopPropagation();
        box.remove();
        const latS = await uiPrompt('위도(Latitude)\n십진수(예: 37.4631) 또는 DMS(예: 37 27 47 N)', '');
        if (latS === null) { cb(null); return; }
        const lat = _parseLatLonInput(latS);
        if (lat === null || lat < -90 || lat > 90) { uiAlert('위도 형식 오류'); cb(null); return; }
        const lonS = await uiPrompt('경도(Longitude)\n십진수(예: 126.4407) 또는 DMS(예: 126 26 27 E)', '');
        if (lonS === null) { cb(null); return; }
        const lon = _parseLatLonInput(lonS);
        if (lon === null || lon < -180 || lon > 180) { uiAlert('경도 형식 오류'); cb(null); return; }
        cb({ lat, lon, name: '' });
    });
}

async function _pdfCalFinish() {
    if (_pdfCalPts.length < 2) { uiAlert('점을 2개 이상 찍어야 합니다. (3개 이상 권장)'); return; }
    // 점들이 모두 너무 가까우면 거부
    let far = 0;
    for (let i = 0; i < _pdfCalPts.length; i++) for (let j = i + 1; j < _pdfCalPts.length; j++)
        far = Math.max(far, Math.hypot(_pdfCalPts[i].fx - _pdfCalPts[j].fx, _pdfCalPts[i].fy - _pdfCalPts[j].fy));
    if (far < 0.02) { uiAlert('점들이 너무 가깝습니다. 더 멀리 떨어진 지점을 포함하세요.'); return; }

    const pts = _pdfCalPts.slice();
    const fit = _pdfFit(pts);
    if (!fit) { uiAlert('보정식을 계산하지 못했습니다. 점을 다시 찍어 주세요.'); return; }

    // ── 품질 게이트 ──
    // 보정점끼리 모순되면(좌표를 잘못 고른 점이 있으면) 그대로 저장하지 않는다.
    // 종전에는 잔차가 수천 km 여도 "보정 완료" 로 끝나 사용자가 알 수 없었다.
    {
        const rm = _pdfCalibRmsMeters(pts, fit.rms);
        const sc = _pdfScaleCheck(pts);
        const bad = _pdfWorstPoint(fit, pts);
        // 보정점들이 덮는 지리 범위 — 잔차를 이 범위와 견준다
        let span = 0;
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
            span = Math.max(span, distance(pts[i].lat, pts[i].lon, pts[j].lat, pts[j].lon) * 1852);
        const tooBig = (rm != null && span > 0 && rm > span * 0.08) || (rm != null && rm > 3700);
        const inconsistent = sc && sc.ratio > 1.25;
        if (tooBig || inconsistent) {
            let m = `⚠ 보정점들이 서로 맞지 않습니다.\n\n`;
            if (rm != null) m += `보정점 잔차: 약 ${Math.round(rm)}m (보정 범위 ${Math.round(span)}m)\n`;
            if (sc) m += `쌍별 축척 차이: ${sc.ratio.toFixed(2)}배 (1.00 이 정상)\n`;
            m += `\n`;
            if (bad) m += `▸ "${bad.label}" 점의 좌표가 어긋난 것으로 보입니다.\n  그 점을 지우고 다시 찍어 주세요.\n\n`;
            else m += `▸ 좌표를 잘못 고른 점이 있습니다.\n  한 점 더 찍으면 어느 점인지 짚어 드립니다.\n\n`;
            m += `찍은 점:\n` + pts.map((p, i) =>
                `  ${i + 1}. ${p.name || '(이름없음)'} ${decToDMS(p.lat, true)} ${decToDMS(p.lon, false)}`).join('\n');
            if (!await uiConfirm(m, { okText: '이대로 저장', cancelText: '계속 수정' })) return;
        }
    }

    _pdfCalibration = { pts, fit };
    _saveChartCalib(_pdfChartKey, _pdfCalibration);
    _pdfCancelCalibration();
    _pdfUpdateAcMarker();
    const rmLoo = _pdfCalibRmsMeters(pts, fit.loo);
    const rmRes = _pdfCalibRmsMeters(pts, fit.rms);
    const kindTxt = (fit.kind === 'affine' ? '아핀 변환' : '닮음 변환') + `(${fit.n}점)`;
    uiAlert(`위치 보정 완료!\n방식: ${kindTxt}` +
          (rmLoo != null ? `\n예상 오차(교차검증): 약 ${Math.round(rmLoo)}m` : '') +
          (rmRes != null ? `\n보정점 잔차: 약 ${Math.round(rmRes)}m` : '') +
          (fit.spread != null && fit.spread < 0.12
             ? `\n\n⚠ 보정점이 일직선에 가까워 정확도가 떨어질 수 있습니다.\n삼각형이 되도록 다시 찍으면 좋아집니다.` : '') +
          (pts.length === 3 ? `\n\n※ 3점은 회전·축척·이동만 맞춥니다.\n한 점 더 찍으면 차트 왜곡까지 보정합니다.` : '') +
          `\n\n현재 위치(▲)가 차트에 표시됩니다.\n⚠ 참고용입니다. 실제 항법에 사용하지 마세요.`);
}

// 캔버스 픽셀 예산 — 이 한도 안에서 가능한 한 높은 해상도로 렌더한다.
// iOS Safari는 캔버스 최대 면적이 약 16.7M px라 이를 넘기면 빈 화면이 된다.
const _PDF_IS_IOS = /iP(ad|hone|od)/.test(navigator.userAgent || '') ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const _PDF_PX_BUDGET = _PDF_IS_IOS ? 16000000 : 60000000;

// 앱 안에서 못 여는 차트 — 새 탭으로 나가기 전에 알리고 고르게 한다.
// 확인 버튼은 <a target="_blank"> 라 팝업 차단에 걸리지 않는다.
async function _offerExternalChart(icao, chartNum, url) {
    if (!url) {
        uiToast(`${icao} (${chartNum}) 차트를 열 수 없습니다 — 이 기기에 저장돼 있지 않습니다.`, 'warn');
        return;
    }
    await uiConfirm(
        `${icao} · (${chartNum}) 차트가 이 기기에 저장돼 있지 않습니다.\n\n` +
        `앱을 벗어나 eAIP 공식 페이지가 새 탭에서 열립니다.\n` +
        `앱 안에서 보려면 CHART 화면의 [가져오기]로 AIRAC 파일을 한 번 넣어 주세요.\n` +
        `(차트 가져오기는 기기·브라우저마다 따로 저장됩니다)`,
        { okText: '새 탭에서 열기', cancelText: '취소', linkHref: url });
}

async function openChart(icao, chartNum, url) {
    const key = `${icao}|${chartNum}`;
    // 로컬 저장된 PDF가 있으면 항상 앱 내장 '한 페이지' 뷰어로 연다.
    // (localPdfKeys 캐시가 갱신 안 됐을 수 있으므로 IndexedDB를 직접 확인)
    let blob = null;
    try { blob = await idbGet(key); } catch(e) { _swallow(e); }
    // 이 기기에 가져온 PDF 가 없으면 종전에는 곧장 window.open 으로 외부 eAIP
    // 페이지를 새 탭에 띄웠다. 그러면 앱 화면이 통째로 사라져 "차트를 열었더니
    // 전체화면으로 바뀐다"로 보인다. 차트 가져오기는 기기·브라우저마다 따로라
    // (폰에서 가져와도 태블릿 브라우저에는 없다) 흔히 겪는다.
    // 무슨 일이 벌어질지 알리고 사용자가 고르게 한다.
    if (!blob) { await _offerExternalChart(icao, chartNum, url); return; }

    _pdfChartKey = key;
    _pdfCalibration = _loadChartCalib(key);
    _pdfCalActive = false; _pdfCalPts = []; _pdfFixList = [];

    const ex = document.getElementById('pdfViewerOverlay');
    if (ex) ex.remove();
    const ov = document.createElement('div');
    ov.id = 'pdfViewerOverlay';
    // CDU 창(#cdu-wrap) 내부에 표시 — 전체 화면이 필요하면 Full Screen 탭 사용
    // 호스트는 언제나 CDU 창이다. 종전에는 없을 때 document.body 로 떨어져
    // position:fixed;inset:0 으로 뷰포트 전체를 덮었는데, 그 경로는 화면을
    // 통째로 가리는 사고밖에 만들지 않아 없앴다.
    const host = document.getElementById('cdu-wrap');
    if (!host) { uiToast('CDU 창을 찾지 못해 차트를 열 수 없습니다.', 'err'); return; }
    // CDU 안에 얹을 때는 inset:0(패널 전체)이 아니라 CDU 화면과 같은 사각형에 맞춘다.
    // 그래야 넓은 창(삼성 덱스 등)에서 차트가 패널을 통째로 덮지 않는다.
    // 차트는 CDU 화면들 중 유일하게 패널 영역을 다 쓴다. 다른 화면은 354×567
    // 계기 테두리 안에 그리지만, 차트는 글씨가 작아 넓게 볼수록 쓸모가 있다.
    // 그래도 패널 밖(상단 탭 줄·옆 창)으로는 절대 넘어가지 않는다.
    ov.dataset.host = 'cdu';
    ov.style.cssText = 'position:absolute;inset:0;z-index:60;'
        + 'background:#1a1a1a;display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;';
    ov.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:#000;border-bottom:1px solid #333;flex-shrink:0;">
            <div data-act="closePdfViewer" style="color:#0ff;font-size:11px;font-weight:bold;cursor:pointer;padding:4px 10px;border:1px solid #0ff;border-radius:4px;white-space:nowrap;">← 목록</div>
            <span style="color:#aaa;font-size:9px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${icao} · (${chartNum})</span>
            <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;">
                <div data-act="_pdfZoomOut" title="축소" style="color:#fff;font-size:16px;font-weight:bold;cursor:pointer;padding:2px 9px;background:#1a1a1a;border:1px solid #444;border-radius:3px;line-height:1;user-select:none;">−</div>
                <div id="pdfZoomLabel" style="color:#aaa;font-size:9px;min-width:36px;text-align:center;padding:3px 2px;"></div>
                <div data-act="_pdfZoomIn"  title="확대" style="color:#fff;font-size:16px;font-weight:bold;cursor:pointer;padding:2px 9px;background:#1a1a1a;border:1px solid #444;border-radius:3px;line-height:1;user-select:none;">+</div>
                <div data-act="_pdfZoomReset" title="배율 초기화" style="color:#888;font-size:9px;cursor:pointer;padding:3px 6px;background:#111;border:1px solid #333;border-radius:3px;margin-left:2px;white-space:nowrap;">1:1</div>
                <div data-act="_pdfToggleCalibration" id="pdfCalBtn" title="현재 위치 보정/표시" style="color:#ff5252;font-size:13px;cursor:pointer;padding:2px 8px;background:#1a1010;border:1px solid #ff5252;border-radius:3px;margin-left:2px;line-height:1;user-select:none;">📍</div>
            </div>
            <span id="pdfPageNum" style="color:#888;font-size:9px;white-space:nowrap;"></span>
        </div>
        <div id="pdfViewArea" style="flex:1;overflow:hidden;position:relative;background:#555;touch-action:none;">
            <div style="color:#ccc;padding:50px;text-align:center;font-size:13px;">PDF 로딩 중...</div>
        </div>
        <div id="pdfNavBar" style="display:flex;border-top:1px solid #333;flex-shrink:0;">
            <div data-act="_pdfPrev" style="flex:1;padding:11px 0;text-align:center;background:#0a0a0a;color:#0ff;font-size:16px;cursor:pointer;border-right:1px solid #222;">◀</div>
            <div id="pdfPageLabel" style="flex:2;padding:11px 0;text-align:center;background:#0a0a0a;color:#555;font-size:10px;"></div>
            <div data-act="_pdfNext" style="flex:1;padding:11px 0;text-align:center;background:#0a0a0a;color:#0ff;font-size:16px;cursor:pointer;border-left:1px solid #222;">▶</div>
        </div>`;
    host.appendChild(ov);
    // 제스처 핸들러는 오버레이당 1회 등록(영역은 재렌더돼도 동일 element 유지)
    const viewArea = document.getElementById('pdfViewArea');
    _pdfAttachTouch(viewArea);
    _pdfAttachWheel(viewArea);
    _pdfAttachMouse(viewArea);
    // CDU 창 크기 변화(Full Screen 전환 등) 시 페이지를 새 크기에 맞춰 재렌더
    if (window.ResizeObserver) {
        let w0 = viewArea.clientWidth, h0 = viewArea.clientHeight;
        _pdfResizeObs = new ResizeObserver(() => {
            const w = viewArea.clientWidth, h = viewArea.clientHeight;
            if (!_pdfDoc || w === 0 || h === 0 || (w === w0 && h === h0)) return;
            w0 = w; h0 = h;
            clearTimeout(_pdfResizeT);
            _pdfResizeT = setTimeout(() => { if (_pdfDoc) _pdfRender(); }, 200);
        });
        _pdfResizeObs.observe(viewArea);
    }
    try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
        _pdfDoc = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
        _pdfCurPage = 1;
        await _pdfRender();
        _pdfUpdateAcMarker();
        if (_pdfAcTimer) clearInterval(_pdfAcTimer);
        _pdfAcTimer = setInterval(_pdfUpdateAcMarker, 1000);   // GPS 위치 실시간 반영
        _pdfExtractFixes();   // 텍스트 페이지에서 픽스 좌표 자동 추출(백그라운드)
    } catch(e) {
        const area = document.getElementById('pdfViewArea');
        if (area) area.innerHTML = `<div style="color:#f44336;padding:30px;font-size:12px;">오류: ${e.message}</div>`;
    }
}

// 페이지 전환/최초 표시: 뷰(이동·배율·품질)를 초기화하고 그린다
async function _pdfRender() {
    if (_pdfReqTimer) { clearTimeout(_pdfReqTimer); _pdfReqTimer = null; }
    _pdfTx = 0; _pdfTy = 0; _pdfScale = 1; _pdfRenderQ = 1;
    await _pdfDrawPage(true);
    _pdfScheduleQuality();   // fit 상태에서도 보이는 영역 선명 렌더
    const lbl = document.getElementById('pdfPageLabel');
    if (lbl) lbl.textContent = `${_pdfCurPage} / ${_pdfDoc.numPages}`;
    const num = document.getElementById('pdfPageNum');
    if (num) num.textContent = `${_pdfCurPage}/${_pdfDoc.numPages}`;
    // 페이지가 1장뿐이면 ◀/▶ 네비게이션 바 숨김
    const nav = document.getElementById('pdfNavBar');
    if (nav) nav.style.display = _pdfDoc.numPages > 1 ? 'flex' : 'none';
}

// 현재 페이지를 _pdfRenderQ 품질(비트맵 해상도)로 그린다.
// resetLayout=true: fit 기준 CSS 박스·중앙정렬 재계산 / false: 현재 뷰 유지(품질만 교체)
async function _pdfDrawPage(resetLayout) {
    if (!_pdfDoc) return;
    const area = document.getElementById('pdfViewArea');
    if (!area) return;
    const token = ++_pdfRenderToken;
    if (resetLayout) area.innerHTML = '<div style="color:#ccc;padding:50px;text-align:center;font-size:12px;">렌더링 중...</div>';

    const page = await _pdfDoc.getPage(_pdfCurPage);
    if (token !== _pdfRenderToken) return;
    const dpr = window.devicePixelRatio || 1;
    const vp0 = page.getViewport({ scale: 1 });

    if (resetLayout) {
        const aW = area.clientWidth, aH = area.clientHeight;
        _pdfFitScale = Math.min(aW / vp0.width, aH / vp0.height);
        _pdfBaseW = vp0.width  * _pdfFitScale;   // 1배(fit)일 때 CSS 크기
        _pdfBaseH = vp0.height * _pdfFitScale;
        _pdfOx = (aW - _pdfBaseW) / 2;
        _pdfOy = (aH - _pdfBaseH) / 2;
    }

    // 비트맵은 fit × dpr × 품질배율 해상도로 렌더 → 확대해도 선명
    const viewport = page.getViewport({ scale: _pdfFitScale * dpr * _pdfRenderQ });
    const canvas = document.createElement('canvas');
    canvas.id = 'pdfCanvas';
    canvas.width  = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    // CSS 박스는 항상 fit 크기로 고정 → 이동·배율 transform 수식이 품질과 무관하게 동일
    canvas.style.cssText = `position:absolute;left:${_pdfOx}px;top:${_pdfOy}px;width:${_pdfBaseW}px;height:${_pdfBaseH}px;transform-origin:0 0;`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    if (token !== _pdfRenderToken) return;   // 더 최신 렌더가 시작됐으면 폐기

    area.innerHTML = '';
    area.appendChild(canvas);
    _pdfApplyTransform();
}

// 확대/이동이 멈추면, '보이는 영역만' PDF 원본 해상도로 재렌더(디바운스).
// 화면에 보이는 부분만 그리므로 캔버스 크기가 화면 크기로 한정 →
// iOS 캔버스 면적 한도를 넘지 않으면서 어떤 배율에서도 선명하게 보인다.
function _pdfScheduleQuality() {
    if (_pdfReqTimer) clearTimeout(_pdfReqTimer);
    _pdfReqTimer = setTimeout(() => {
        _pdfReqTimer = null;
        _pdfRenderHi();
    }, 160);
}

let _pdfHiToken = 0;
// 현재 보이는 영역을 줌 배율 그대로의 해상도로 렌더해 선명한 오버레이로 표시
async function _pdfRenderHi() {
    if (!_pdfDoc) return;
    const area = document.getElementById('pdfViewArea');
    if (!area) return;
    const token = ++_pdfHiToken;

    const AW = area.clientWidth, AH = area.clientHeight;
    const S = _pdfScale;
    const left = _pdfOx + _pdfTx, top = _pdfOy + _pdfTy;   // 화면상 페이지 좌상단
    const pageW = _pdfBaseW * S, pageH = _pdfBaseH * S;     // 화면상 페이지 크기

    // 페이지와 뷰영역의 교집합(=실제로 보이는 부분, CSS px)
    const visL = Math.max(0, left), visT = Math.max(0, top);
    const visR = Math.min(AW, left + pageW), visB = Math.min(AH, top + pageH);
    const cssW = visR - visL, cssH = visB - visT;
    if (cssW <= 1 || cssH <= 1) return;

    // 디바이스 픽셀 배율 q (예산 안에서 최대 선명도)
    const dpr = window.devicePixelRatio || 1;
    let q = dpr;
    if (cssW * q * cssH * q > _PDF_PX_BUDGET) {
        q = Math.sqrt(_PDF_PX_BUDGET / (cssW * cssH));
    }
    const cw = Math.max(1, Math.round(cssW * q));
    const ch = Math.max(1, Math.round(cssH * q));

    // 전체 페이지를 (fit×S×q) 배율로 렌더하되, 보이는 sub-rect만 캔버스에 담는다.
    const page = await _pdfDoc.getPage(_pdfCurPage);
    if (token !== _pdfHiToken) return;
    const renderScale = _pdfFitScale * S * q;
    const viewport = page.getViewport({ scale: renderScale });
    const offX = (visL - left) * q;   // 보이는 영역의 페이지 내 디바이스 오프셋
    const offY = (visT - top) * q;

    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    try {
        await page.render({
            canvasContext: canvas.getContext('2d'),
            viewport,
            transform: [1, 0, 0, 1, -offX, -offY]   // 보이는 영역이 캔버스 원점에 오도록 이동
        }).promise;
    } catch(e) { return; }
    if (token !== _pdfHiToken) return;   // 더 최신 요청이 있으면 폐기

    // 이동/줌 중 새로 들어온 제스처로 위치가 바뀌었으면 무효
    const ex = document.getElementById('pdfHiCanvas');
    if (ex) ex.remove();
    canvas.id = 'pdfHiCanvas';
    canvas.style.cssText = `position:absolute;left:${visL}px;top:${visT}px;width:${cssW}px;height:${cssH}px;pointer-events:none;`;
    area.appendChild(canvas);
}

function _pdfApplyTransform() {
    _pdfClampPan();   // 이동 범위를 차트 안으로 제한(회색 여백으로 끌려나감 방지)
    const c = document.getElementById('pdfCanvas');
    if (c) c.style.transform = `translate(${_pdfTx}px,${_pdfTy}px) scale(${_pdfScale})`;
    // 이동/줌이 시작되면 선명 오버레이는 위치가 어긋나므로 제거(미리보기만 표시)
    const hi = document.getElementById('pdfHiCanvas');
    if (hi) hi.remove();
    const lz = document.getElementById('pdfZoomLabel');
    if (lz) lz.textContent = Math.round(_pdfScale * 100) + '%';
    _pdfUpdateAcMarker();   // 항공기 심볼도 이동/줌에 맞춰 갱신
    if (_pdfCalActive) _pdfDrawCalDots();   // 보정 점들도 이동/줌에 맞춰 갱신
}

const _PDF_ZOOM_STEP = 0.25;
const _PDF_ZOOM_MIN  = 1;      // 화면맞춤(fit)보다 더 축소 금지 → 회색 여백 증가 방지
const _PDF_ZOOM_MAX  = 8;

// 이동(pan) 범위를 차트(페이지) 안으로 제한한다.
// - 페이지가 뷰보다 큰 축: 가장자리가 뷰 안으로 들어오지 않게 clamp(회색 안 보임)
// - 페이지가 뷰보다 작은 축(예: fit 상태의 레터박스): 가운데 정렬 고정
function _pdfClampPan() {
    const area = document.getElementById('pdfViewArea');
    if (!area) return;
    const AW = area.clientWidth, AH = area.clientHeight;
    const pageW = _pdfBaseW * _pdfScale, pageH = _pdfBaseH * _pdfScale;
    // 화면상 페이지 좌상단 = _pdfO* + _pdfT*  →  이 값을 허용범위로 clamp
    if (pageW >= AW) {
        const minLeft = AW - pageW, maxLeft = 0;      // [AW-pageW, 0]
        let left = _pdfOx + _pdfTx;
        left = Math.min(maxLeft, Math.max(minLeft, left));
        _pdfTx = left - _pdfOx;
    } else {
        _pdfTx = (AW - pageW) / 2 - _pdfOx;            // 가운데 정렬
    }
    if (pageH >= AH) {
        const minTop = AH - pageH, maxTop = 0;
        let top = _pdfOy + _pdfTy;
        top = Math.min(maxTop, Math.max(minTop, top));
        _pdfTy = top - _pdfOy;
    } else {
        _pdfTy = (AH - pageH) / 2 - _pdfOy;
    }
}

function _pdfZoomIn() {
    const area = document.getElementById('pdfViewArea');
    if (!area) return;
    const cx = area.clientWidth / 2, cy = area.clientHeight / 2;
    _pdfZoomAt(Math.min(_pdfScale + _PDF_ZOOM_STEP, _PDF_ZOOM_MAX), cx, cy);
}
function _pdfZoomOut() {
    const area = document.getElementById('pdfViewArea');
    if (!area) return;
    const cx = area.clientWidth / 2, cy = area.clientHeight / 2;
    _pdfZoomAt(Math.max(_pdfScale - _PDF_ZOOM_STEP, _PDF_ZOOM_MIN), cx, cy);
}
function _pdfZoomReset() {
    _pdfTx = 0; _pdfTy = 0; _pdfScale = 1;
    _pdfApplyTransform();
    _pdfScheduleQuality();   // 품질 1배로 복귀(메모리 회수)
}
function _pdfZoomAt(newScale, cx, cy) {
    const r = newScale / _pdfScale;
    _pdfTx = (cx - _pdfOx) * (1 - r) + _pdfTx * r;
    _pdfTy = (cy - _pdfOy) * (1 - r) + _pdfTy * r;
    _pdfScale = newScale;
    _pdfApplyTransform();
    _pdfScheduleQuality();
}

// 마우스 휠 줌 (PC)
function _pdfAttachWheel(area) {
    area.addEventListener('wheel', e => {
        // 좌표 피커 위에서는 목록 스크롤이 되도록 줌을 막지 않음
        if (e.target.closest && e.target.closest('#pdfFixPicker')) return;
        e.preventDefault();
        const rc   = area.getBoundingClientRect();
        const cx   = e.clientX - rc.left;
        const cy   = e.clientY - rc.top;
        const step = e.deltaY < 0 ? _PDF_ZOOM_STEP : -_PDF_ZOOM_STEP;
        const ns   = Math.min(Math.max(_pdfScale + step, _PDF_ZOOM_MIN), _PDF_ZOOM_MAX);
        _pdfZoomAt(ns, cx, cy);
    }, { passive: false });
}

// 마우스 드래그 패닝 (PC) — 확대 후 클릭해서 화면 이동
let _pdfMD = null;               // 드래그 상태(전역)
let _pdfMouseDocInit = false;    // document 리스너 1회 등록 가드
function _pdfAttachMouse(area) {
    area.style.cursor = 'grab';
    area.addEventListener('mousedown', e => {
        // 좌표 피커·보정 상단바 위에서 시작된 클릭은 드래그로 취급하지 않음
        // (피커가 선택 즉시 제거되면 mouseup이 유실되어 드래그 상태가 남는 문제 방지)
        if (e.target.closest && e.target.closest('#pdfFixPicker, #pdfCalBar')) return;
        e.preventDefault();
        _pdfMD = { x0: e.clientX, y0: e.clientY, tx0: _pdfTx, ty0: _pdfTy };
        area.style.cursor = 'grabbing';
    });
    if (_pdfMouseDocInit) return;
    _pdfMouseDocInit = true;
    // move/up은 document에 1회만 등록(영역 밖으로 나가도 드래그 유지)
    document.addEventListener('mousemove', e => {
        if (!_pdfMD || !document.getElementById('pdfViewerOverlay')) return;
        // 피커가 열려 있는 동안은 차트 패닝 금지 + 잔여 드래그 상태 해제
        if (document.getElementById('pdfFixPicker')) { _pdfMD = null; return; }
        // 마우스 버튼이 이미 떼어졌는데 상태가 남아있으면 해제(mouseup 유실 대비)
        if (e.buttons === 0) { _pdfMD = null; return; }
        _pdfTx = _pdfMD.tx0 + e.clientX - _pdfMD.x0;
        _pdfTy = _pdfMD.ty0 + e.clientY - _pdfMD.y0;
        _pdfApplyTransform();
    });
    document.addEventListener('mouseup', () => {
        if (_pdfMD) { _pdfMD = null; const a = document.getElementById('pdfViewArea'); if (a) a.style.cursor = 'grab'; _pdfScheduleQuality(); }
    });
}

function _pdfAttachTouch(area) {
    let t = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    // 좌표 피커·보정 상단바 위의 터치는 차트 제스처로 처리하지 않음(목록 스크롤 허용)
    const skipUi = e => e.target.closest && e.target.closest('#pdfFixPicker, #pdfCalBar');
    area.addEventListener('touchstart', e => {
        if (skipUi(e)) { t = null; return; }
        e.preventDefault();
        const rc = area.getBoundingClientRect();
        if (e.touches.length === 1) {
            t = { mode: 'pan', x0: e.touches[0].clientX, y0: e.touches[0].clientY, tx0: _pdfTx, ty0: _pdfTy };
        } else if (e.touches.length >= 2) {
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rc.left;
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rc.top;
            t = { mode: 'pinch', d0: dist(e.touches[0], e.touches[1]), s0: _pdfScale, cx, cy, tx0: _pdfTx, ty0: _pdfTy };
        }
    }, { passive: false });
    area.addEventListener('touchmove', e => {
        if (skipUi(e)) return;
        e.preventDefault();
        if (!t) return;
        if (t.mode === 'pan' && e.touches.length === 1) {
            _pdfTx = t.tx0 + e.touches[0].clientX - t.x0;
            _pdfTy = t.ty0 + e.touches[0].clientY - t.y0;
            _pdfApplyTransform();
        } else if (t.mode === 'pinch' && e.touches.length >= 2) {
            const newScale = Math.min(Math.max(t.s0 * dist(e.touches[0], e.touches[1]) / t.d0, _PDF_ZOOM_MIN), _PDF_ZOOM_MAX);
            const r = newScale / t.s0;
            _pdfScale = newScale;
            _pdfTx = (t.cx - _pdfOx) * (1 - r) + t.tx0 * r;
            _pdfTy = (t.cy - _pdfOy) * (1 - r) + t.ty0 * r;
            _pdfApplyTransform();
        }
    }, { passive: false });
    area.addEventListener('touchend', e => {
        if (e.touches.length === 1 && t?.mode === 'pinch') {
            t = { mode: 'pan', x0: e.touches[0].clientX, y0: e.touches[0].clientY, tx0: _pdfTx, ty0: _pdfTy };
        } else if (e.touches.length === 0) {
            // 핀치 줌·패닝 끝 → 보이는 영역 선명도 보정
            if (t) _pdfScheduleQuality();
            t = null;
        }
    }, { passive: false });
}

async function _pdfPrev() { if (_pdfDoc && _pdfCurPage > 1) { _pdfCurPage--; await _pdfRender(); } }
async function _pdfNext() { if (_pdfDoc && _pdfCurPage < _pdfDoc.numPages) { _pdfCurPage++; await _pdfRender(); } }
function closePdfViewer() {
    _pdfDoc = null; _pdfMD = null;
    if (_pdfReqTimer) { clearTimeout(_pdfReqTimer); _pdfReqTimer = null; }
    if (_pdfAcTimer) { clearInterval(_pdfAcTimer); _pdfAcTimer = null; }
    if (_pdfResizeObs) { try { _pdfResizeObs.disconnect(); } catch(e){ _swallow(e); } _pdfResizeObs = null; }
    if (_pdfResizeT) { clearTimeout(_pdfResizeT); _pdfResizeT = null; }
    _pdfCalActive = false; _pdfCalPts = []; _pdfFixList = [];
    _pdfRenderToken++;   // 진행 중 렌더 무효화
    const ov = document.getElementById('pdfViewerOverlay'); if (ov) ov.remove();
}

function deleteSavedChart(icao, chartNum) {
    let saved = loadSavedCharts().filter(c => !(c.icao === icao && c.chartNum === chartNum));
    localStorage.setItem('savedCharts', JSON.stringify(saved));
    idbDeleteByPrefix(`${icao}|${chartNum}`).then(() => refreshLocalPdfKeys());
}

async function deleteAirportCharts(icao) {
    let saved = loadSavedCharts().filter(c => c.icao !== icao);
    localStorage.setItem('savedCharts', JSON.stringify(saved));
    await idbDeleteByPrefix(`${icao}|`);
    await refreshLocalPdfKeys();
}

let expandedAirport = null;
// 공항을 펼칠 때 목록 전체가 다시 그려지면서 스크롤이 맨 위(ENROUTE/GENERAL)로
// 튀던 문제를 막는다. 보던 위치를 그대로 되돌린 뒤, 펼쳐진 하부 목록이 화면에
// 걸치면 필요한 만큼만 스크롤해 자연스럽게 이어지게 한다.
function toggleExpand(icao) {
    const box = document.getElementById('charts-scroll');
    const prevTop = box ? box.scrollTop : 0;
    const opening = expandedAirport !== icao;
    expandedAirport = opening ? icao : null;
    renderCduContent();
    requestAnimationFrame(() => {
        const b2 = document.getElementById('charts-scroll');
        if (!b2) return;
        b2.scrollTop = prevTop;                       // 보던 위치 복원
        if (!opening) return;
        const grp = document.getElementById('chart-grp-' + icao);
        const hdr = document.getElementById('chart-hdr-' + icao);
        if (!grp || !hdr) return;
        const bb = b2.getBoundingClientRect();
        const gb = grp.getBoundingClientRect();
        const hb = hdr.getBoundingClientRect();
        if (hb.top < bb.top) {                        // 헤더가 위로 잘렸으면 헤더부터 보이게
            b2.scrollTop += hb.top - bb.top;
        } else if (gb.bottom > bb.bottom) {           // 하부 목록이 아래로 넘치면 최소한만 내림
            // 단, 헤더는 화면에 남도록 상한을 둔다
            b2.scrollTop += Math.min(gb.bottom - bb.bottom, hb.top - bb.top);
        }
    });
}

// (개별 다운로드 기능 제거 — ZIP 가져오기 방식으로 통일)

function getAiracInfo_charts() {
    const now = new Date();
    const ref = new Date(2024, 0, 25);
    const dayMs = 86400000;
    const offset = Math.floor((now - ref) / (28 * dayMs));
    const n1 = offset + 1;
    const yr = 2024 + Math.floor((n1 - 1) / 13);
    const cn = ((n1 - 1) % 13) + 1;
    const id = yr.toString().slice(2) + cn.toString().padStart(2, '0');
    const startDate = new Date(ref.getTime() + offset * 28 * dayMs);
    const endDate = new Date(startDate.getTime() + 27 * dayMs);
    const daysLeft = Math.ceil((endDate - now) / dayMs) + 1;
    const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '/');
    const startUrl = startDate.toISOString().slice(0, 10);
    return { id, start: fmt(startDate), end: fmt(endDate), daysLeft: Math.max(1, daysLeft), startUrl };
}

function renderChartsScreen(container, footer, title) {
    title.innerText = "Charts";

    const airac = getAiracInfo_charts();
    const saved = loadSavedCharts();
    const savedByIcao = {};
    saved.forEach(c => {
        if (_isJunkChart(c)) return;   // macOS ._ 메타데이터 등 오류 항목 숨김
        if (!savedByIcao[c.icao]) savedByIcao[c.icao] = { name: c.name, charts: [] };
        savedByIcao[c.icao].charts.push(c);
    });
    const daysColor = airac.daysLeft <= 7 ? '#f44336' : airac.daysLeft <= 14 ? '#ff9800' : '#4caf50';


    let html = `<div style="padding:0 2px;height:100%;display:flex;flex-direction:column;overflow:hidden;">`;

    // AIRAC 헤더 + 가져오기 버튼
    // 버튼을 한 줄에 다 넣으면 CDU 폭(354px)에서 좌측 정보 칸이 눌려
    // "패키지 목록 ↗" 이 한 글자씩 세로로 쪼개지고, 그 탓에 상자가 길어져
    // 초록 여백만 커졌다. 정보 줄과 버튼 줄을 갈라 각자 제 폭을 쓰게 한다.
    const impBtn = (act, icon, label, hint, color, bg) => `
        <div ${importProgress ? '' : act} title="${hint}" style="background:${importProgress ? '#1a1a1a' : bg};color:${importProgress ? '#444' : color};border:1px solid ${importProgress ? '#333' : color};border-radius:4px;padding:4px 2px;cursor:${importProgress ? 'default' : 'pointer'};text-align:center;line-height:1.2;overflow:hidden;">
            <div style="font-size:13px;">${importProgress ? '⏳' : icon}</div>
            <div style="font-size:8px;font-weight:bold;white-space:nowrap;">${label}</div>
            <div style="font-size:6px;opacity:0.65;white-space:nowrap;">${hint}</div>
        </div>`;
    html += `
    <div style="background:#1a2a1a;border:1px solid #4caf50;border-radius:5px;padding:5px 6px;margin-bottom:5px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
            <div style="flex:1;min-width:0;">
                <div style="color:#4caf50;font-size:8px;font-weight:bold;letter-spacing:1px;white-space:nowrap;">AIRAC ${airac.id}</div>
                <div style="color:#aaa;font-size:8px;white-space:nowrap;">${airac.start} ~ ${airac.end}</div>
            </div>
            <a href="https://aim.koca.go.kr/eaipPub/Package/history-en-GB.html?language=ko_KR" target="_blank" style="color:#4caf50;font-size:7px;text-decoration:none;white-space:nowrap;">패키지 목록 ↗</a>
            <div style="text-align:center;flex-shrink:0;">
                <div style="color:${daysColor};font-size:17px;font-weight:bold;line-height:1;">${airac.daysLeft}</div>
                <div style="color:#666;font-size:6px;">days left</div>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">
            ${impBtn('data-act="openAimPackage"', '🌐', 'AIM eAIP', '공식 배포처', '#4caf50', '#0a2a0a')}
            ${impBtn('onclick="triggerZipImport()"', '📂', 'ZIP 가져오기', 'AIRAC 묶음', '#29b6f6', '#0a1a2a')}
            ${impBtn('onclick="triggerFolderImport()"', '📁', '폴더 가져오기', '메모리 부족시', '#ffb74d', '#1a140a')}
        </div>
    </div>`;

    // ZIP 가져오기 진행 바
    if (importProgress) {
        const pct = importProgress.total > 0 ? (importProgress.done / importProgress.total * 100).toFixed(0) : 0;
        const label = importProgress.phase === 'reading' ? 'ZIP 읽는 중...' : `저장 중 ${importProgress.done}/${importProgress.total} (PDF ${importProgress.found}개 발견)`;
        html += `
        <div style="background:#0a1020;border:1px solid #29b6f6;border-radius:4px;padding:5px 8px;margin-bottom:5px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                <div style="color:#29b6f6;font-size:9px;font-weight:bold;">📂 ZIP 가져오기</div>
                <div style="color:#29b6f6;font-size:8px;">${label}</div>
            </div>
            <div style="background:#000;border-radius:3px;height:6px;overflow:hidden;">
                <div style="background:#29b6f6;height:100%;width:${pct}%;transition:width 0.1s;"></div>
            </div>
        </div>`;
    }

    // 저장된 차트 목록 — 펼침 시 스크롤 위치를 유지하려고 id를 둔다
    html += `<div id="charts-scroll" style="flex:1;overflow-y:auto;">`;
    if (saved.length === 0) {
        html += `<div style="text-align:center;color:#444;font-size:10px;margin-top:30px;line-height:2.2;">차트 없음<br><span style="font-size:8px;color:#4caf50;">🌐 AIM eAIP — AIM Korea 사이트에서 AIRAC ZIP 다운</span><br><span style="font-size:8px;color:#29b6f6;">📂 ZIP 가져오기 — 받은 ZIP 파일 선택 후 자동 분류</span></div>`;
    } else {
        // 특수 섹션(ENROUTE/GENERAL)을 맨 위로, 그 외 공항은 ICAO 이름순 정렬
        const icaoKeys = Object.keys(savedByIcao).sort((a, b) => {
            const sa = SECTION_GROUPS[a], sb = SECTION_GROUPS[b];
            if (sa && sb) return sa.order - sb.order;
            if (sa) return -1;
            if (sb) return 1;
            return a.localeCompare(b);
        });
        icaoKeys.forEach(icao => {
            const grp = savedByIcao[icao];
            const section = SECTION_GROUPS[icao];
            const isOpen = expandedAirport === icao;
            // 각 그룹 내 차트를 차트번호 기준 오름차순으로 정렬(번호 없으면 이름)
            grp.charts.sort((c1, c2) => {
                const k1 = (c1.chartNum || c1.chartName || '');
                const k2 = (c2.chartNum || c2.chartName || '');
                return k1.localeCompare(k2, undefined, { numeric: true, sensitivity: 'base' });
            });
            const headTitle = section
                ? `<span style="color:${section.color};">${section.label}</span> <span style="color:#aaa;font-size:9px;font-weight:normal;">${section.sub}</span>`
                : `${icao} <span style="color:#aaa;font-size:9px;font-weight:normal;">${grp.name}</span>`;
            html += `
            <div id="chart-grp-${icao}" style="margin-bottom:4px;border:1px solid ${section ? section.color : '#333'};border-radius:4px;overflow:hidden;">
                <div id="chart-hdr-${icao}" onclick="toggleExpand('${icao}')" style="display:flex;align-items:center;padding:6px 6px;background:#151515;cursor:pointer;gap:4px;">
                    <div style="color:#0ff;font-size:11px;font-weight:bold;">${isOpen ? '▼' : '▶'}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="color:#fff;font-size:11px;font-weight:bold;">${headTitle}</div>
                        <div style="color:#666;font-size:8px;">${grp.charts.length}개</div>
                    </div>
                    <div onclick="event.stopPropagation(); deleteAirportCharts('${icao}')" style="color:#f44336;font-size:9px;cursor:pointer;padding:2px 5px;border:1px solid #f44336;border-radius:3px;white-space:nowrap;">삭제</div>
                </div>`;
            if (isOpen) {
                grp.charts.forEach(c => {
                    const status = c.status || 'unverified';
                    const cat = inferChartCat(c);
                    const catColor = chartCatColors[cat] || '#888';
                    const safeUrl = (c.url || '').replace(/'/g, '%27');
                    const link = isSectionLink(c);
                    const isLocal = !link && localPdfKeys.has(`${c.icao}|${c.chartNum}`);
                    const leftIcon = link
                        ? `<div style="font-size:12px;padding:0 4px;line-height:1;width:16px;text-align:center;flex-shrink:0;">🔗</div>`
                        : isLocal
                            ? `<div style="font-size:12px;padding:0 4px;line-height:1;width:16px;text-align:center;flex-shrink:0;color:#29b6f6;">📂</div>`
                            : `<div style="width:16px;flex-shrink:0;"></div>`;
                    const titleLine = link ? `${c.chartName}` : `(${c.chartNum}) ${c.chartName}`;
                    const subLine = link
                        ? `eAIP 공식 페이지 · 모든 ${cat} 차트 포함`
                        : `AIRAC ${c.airac || '-'}${isLocal ? ' · 로컬 저장됨' : ''}`;
                    const bgColor = isLocal ? '#040d12' : link ? '#0d1418' : '#0a0a0a';
                    const arrowColor = isLocal ? '#29b6f6' : '#4caf50';
                    const onclickAction = link
                        ? `uiOpenExternal('${safeUrl}')`
                        : `openChart('${c.icao}','${c.chartNum}','${safeUrl}')`;
                    html += `
                    <div onclick="${onclickAction}" style="display:flex;align-items:center;padding:7px 8px;border-top:1px solid #222;gap:5px;background:${bgColor};cursor:pointer;-webkit-tap-highlight-color:rgba(41,182,246,0.15);">
                        ${leftIcon}
                        <span style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}55;border-radius:3px;font-size:7px;padding:1px 4px;min-width:30px;text-align:center;font-weight:bold;flex-shrink:0;">${cat}</span>
                        <div style="flex:1;min-width:0;">
                            <div style="color:#fff;font-size:9px;font-weight:bold;">${titleLine}</div>
                            <div style="color:${isLocal ? '#1e6a8a' : '#555'};font-size:7px;">${subLine}</div>
                        </div>
                        <span style="color:${arrowColor};font-size:9px;flex-shrink:0;">${isLocal ? '▶' : '↗'}</span>
                        <div onclick="event.stopPropagation(); deleteSavedChart('${c.icao}','${c.chartNum}')" style="color:#f44336;font-size:14px;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;">✕</div>
                    </div>`;
                });
            }
            html += `</div>`;
        });
    }
    html += `</div></div>`;

    container.innerHTML = html;
    footer.innerHTML = cduFooter("switchMode('HOME')");
}

// renderCduContent는 CDU 내부의 renderContent를 가리킴
function renderCduContent() {
    try {
        if (window._cduRenderContent) window._cduRenderContent();
    } catch(e) { console.warn('renderCduContent error:', e); }
}


// ── 위임 액션 등록 (인라인 onclick 에서 옮겨온 것들) ──
// 여기 없는 이름을 data-act 로 쓰면 콘솔에 경고가 남으므로,
// 예전처럼 버튼이 조용히 죽지 않는다.
appRegister({
  _pdfNext,
  _pdfPrev,
  _pdfToggleCalibration,
  _pdfZoomIn,
  _pdfZoomOut,
  _pdfZoomReset,
  _rulerReset,
  _rulerUndo,
  addAirwaySegment,
  addAppWps,
  addSidWps,
  addSingleFix,
  addStarWps,
  cduFullScreen,
  clearFP,
  closeHelp,
  closePdfViewer,
  closeWxPanel,
  cycleIntercept,
  deleteUserSid,
  exitSolo,
  fcpSync,
  fdrPause,
  fdrPlay,
  fdrStop,
  fetchWx,
  forceTrim,
  fpBackToCdu,
  fpBksp,
  fpConfirmIdent,
  fpGo,
  fpAddPP,
  fpAddPreset,
  fpWptOpen,
  fpWptNoop,
  fpWptDirect,
  fpWptDel,
  fpWptRename,
  fpWptCoord,
  fpWptNum,
  fpConfirmWptNum,
  fpHoldNum,
  fpConfirmHoldNum,
  fpHoldOpen,
  fpGoCduHome,
  fpHoldApply,
  fpHoldRemove,
  fpHoldSet,
  fpRefNum,
  fpPadClr,
  fpConfirmRefNum,
  fpRefApply,
  fpRefBksp,
  fpRefOpen,
  fpType,
  hardReload,
  lockScreen,
  openAimPackage,
  openShipPanel,
  planFullScreen,
  resetSim,
  selectPanel,
  setNavSrc,
  setRnp,
  setSolo,
  shipKey,
  shipSetMode,
  shipToggleOn,
  shipTogglePanel,
  sidNewAddFix,
  sidNewSave,
  sidShowOnMap,
  swReset,
  swSetMode,
  swToggle,
  switchMode,
  tiltAdj,
  toggle3dMap,
  toggleAltHold,
  toggleAspcPanel,
  toggleAwyLayer,
  toggleBrg1,
  toggleBrg2,
  toggleBrg1Lbl,
  toggleBrg2Lbl,
  toggleCrht,
  toggleFdrPanel,
  toggleFixPanel,
  toggleFollow,
  toggleGPS,
  toggleGspd,
  toggleHoverPage,
  toggleHoverPosition,
  toggleInhib,
  toggleInhibMenu,
  toggleLayer,
  toggleMapFull,
  toggleMapOrient,
  toggleNavAp,
  toggleNotamLayer,
  toggleObs,
  togglePpMenu,
  toggleRain,
  toggleRuler,
  toggleShip,
  toggleSim,
  setSimSpeed,
  toggleHoldEntry,
  toggleTcut,
  toggleTrackRec,
  toggleTriple,
  toggleWind,
  toggleWxPanel,
});
