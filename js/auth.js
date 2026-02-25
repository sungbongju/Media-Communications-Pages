/**
 * ================================================
 * auth.js — 미디어커뮤니케이션 랜딩페이지 로그인/세션 관리
 * ================================================
 * 
 * 기능:
 * 1. 학번+이름 간단 로그인
 * 2. JWT 토큰 기반 세션 유지 (localStorage)
 * 3. 로그인 모달 UI 제어
 * 4. 아바타 iframe에 사용자 정보 전달 (postMessage)
 * 
 * 의존성: 없음 (Vanilla JS)
 * 삽입 위치: index.html의 </body> 직전
 * ================================================
 */

// ============================================
// 🔧 설정
// ============================================
const AUTH_CONFIG = {
  // 학교 서버 API 주소 (치매예방게임과 동일한 PHP 방식)
  API_BASE: 'https://aiforalab.com/mediacom-api/api.php',
  // 토큰 저장 키
  TOKEN_KEY: 'mediacom_token',
  USER_KEY: 'mediacom_user',
  SESSION_KEY: 'mediacom_session',
  // 토큰 만료 시간 (7일)
  TOKEN_EXPIRY_DAYS: 7,
};

// ============================================
// 🔐 AuthManager 클래스
// ============================================
class AuthManager {
  constructor() {
    this.user = null;
    this.token = null;
    this.sessionId = this._generateSessionId();
    this.isLoggedIn = false;
    this.onLoginCallbacks = [];
    this.onLogoutCallbacks = [];
  }

  // ── 초기화 ──
  async init() {
    // localStorage에서 기존 세션 복원
    const savedToken = localStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
    const savedUser = localStorage.getItem(AUTH_CONFIG.USER_KEY);

    if (savedToken && savedUser) {
      try {
        this.token = savedToken;
        this.user = JSON.parse(savedUser);

        // 토큰 유효성 검증
        const isValid = await this._verifyToken();
        if (isValid) {
          this.isLoggedIn = true;
          this._onLoginSuccess();
          console.log('🔐 세션 복원:', this.user.name);
          return true;
        }
      } catch (e) {
        console.log('🔐 세션 만료, 재로그인 필요');
      }
    }

    // 세션 없으면 로그인 모달 표시
    this._showLoginModal();
    return false;
  }

  // ── 로그인 ──
  async login(studentId, name) {
    if (!studentId || !name) {
      throw new Error('학번과 이름을 입력해주세요.');
    }

    // 학번 형식 검증 (숫자만, 최소 4자리)
    if (!/^\d{4,}$/.test(studentId.trim())) {
      throw new Error('학번은 숫자로만 입력해주세요.');
    }

    try {
      const response = await fetch(`${AUTH_CONFIG.API_BASE}?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId.trim(),
          name: name.trim()
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || '로그인 실패');
      }

      const data = await response.json();

      // 저장
      this.token = data.token;
      this.user = data.user;
      this.isLoggedIn = true;

      localStorage.setItem(AUTH_CONFIG.TOKEN_KEY, data.token);
      localStorage.setItem(AUTH_CONFIG.USER_KEY, JSON.stringify(data.user));
      localStorage.setItem(AUTH_CONFIG.SESSION_KEY, this.sessionId);

      this._onLoginSuccess();
      this._hideLoginModal();

      console.log('🔐 로그인 성공:', this.user.name);
      return data.user;

    } catch (error) {
      // 서버 연결 실패 시 오프라인 모드
      if (error.message.includes('fetch') || error.message.includes('NetworkError')) {
        console.warn('🔐 서버 연결 불가 - 오프라인 모드');
        return this._offlineLogin(studentId, name);
      }
      throw error;
    }
  }

  // ── 오프라인 모드 로그인 (서버 연결 안 될 때) ──
  _offlineLogin(studentId, name) {
    this.user = {
      id: null,
      student_id: studentId.trim(),
      name: name.trim(),
      offline: true
    };
    this.isLoggedIn = true;

    localStorage.setItem(AUTH_CONFIG.USER_KEY, JSON.stringify(this.user));
    localStorage.setItem(AUTH_CONFIG.SESSION_KEY, this.sessionId);

    this._onLoginSuccess();
    this._hideLoginModal();

    console.log('🔐 오프라인 로그인:', this.user.name);
    return this.user;
  }

  // ── 로그아웃 ──
  logout() {
    this.user = null;
    this.token = null;
    this.isLoggedIn = false;

    localStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
    localStorage.removeItem(AUTH_CONFIG.USER_KEY);
    localStorage.removeItem(AUTH_CONFIG.SESSION_KEY);

    this.onLogoutCallbacks.forEach(cb => cb());
    this._showLoginModal();

    console.log('🔐 로그아웃');
  }

  // ── 토큰 검증 ──
  async _verifyToken() {
    try {
      const response = await fetch(`${AUTH_CONFIG.API_BASE}?action=verify`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      return response.ok;
    } catch {
      // 서버 연결 불가 시 로컬 토큰으로 진행
      return true;
    }
  }

  // ── 로그인 성공 후 처리 ──
  _onLoginSuccess() {
    // 1) 환영 메시지 표시
    this._updateUserUI();

    // 2) 아바타 iframe에 사용자 정보 전달
    this._notifyAvatar();

    // 3) 콜백 실행
    this.onLoginCallbacks.forEach(cb => cb(this.user));
  }

  // ── UI 업데이트 ──
  _updateUserUI() {
    // 환영 배지 표시
    const badge = document.getElementById('user-badge');
    if (badge) {
      badge.textContent = `${this.user.name}님`;
      badge.style.display = 'inline-flex';
    }

    // 로그아웃 버튼 표시
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.style.display = 'inline-flex';
    }
  }

  // ── 아바타에 사용자 정보 전달 ──
  _notifyAvatar() {
    const avatarIframe = document.getElementById('heygen-pip');
    if (avatarIframe && avatarIframe.contentWindow) {
      avatarIframe.contentWindow.postMessage({
        type: 'USER_LOGIN',
        user: {
          name: this.user.name,
          student_id: this.user.student_id,
          session_id: this.sessionId
        }
      }, '*');
    }
  }

  // ── 로그인 모달 표시 ──
  _showLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }

  // ── 로그인 모달 숨기기 ──
  _hideLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // ── 세션 ID 생성 ──
  _generateSessionId() {
    return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  // ── 이벤트 등록 ──
  onLogin(callback) { this.onLoginCallbacks.push(callback); }
  onLogout(callback) { this.onLogoutCallbacks.push(callback); }

  // ── Getter ──
  getUser() { return this.user; }
  getToken() { return this.token; }
  getSessionId() { return this.sessionId; }
  getAuthHeaders() {
    return this.token
      ? { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }
}

// ============================================
// 🌐 전역 인스턴스
// ============================================
const authManager = new AuthManager();

// ============================================
// 🎬 로그인 모달 이벤트 바인딩
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  // 로그인 폼 제출
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const studentId = document.getElementById('login-student-id').value;
      const name = document.getElementById('login-name').value;
      const errorEl = document.getElementById('login-error');
      const submitBtn = loginForm.querySelector('button[type="submit"]');

      // 로딩 상태
      submitBtn.disabled = true;
      submitBtn.textContent = '로그인 중...';
      errorEl.textContent = '';
      errorEl.style.display = 'none';

      try {
        await authManager.login(studentId, name);
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '시작하기';
      }
    });
  }

  // 게스트 입장 버튼
  const guestBtn = document.getElementById('login-guest-btn');
  if (guestBtn) {
    guestBtn.addEventListener('click', () => {
      authManager._hideLoginModal();
    });
  }

  // 로그아웃 버튼
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      authManager.logout();
    });
  }

  // 학번 입력 필드 — 숫자만 허용
  const studentIdInput = document.getElementById('login-student-id');
  if (studentIdInput) {
    studentIdInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
  }

  // 초기화
  authManager.init();
});
