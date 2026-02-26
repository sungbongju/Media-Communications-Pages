/**
 * ================================================
 * auth.js - 미디어커뮤니케이션학 로그인 + 행동추적 + 분석
 * ================================================
 * 
 * 기능:
 * 1. 로그인/로그아웃 (학번+이름 / 게스트)
 * 2. 아바타 봇에 사용자 정보 + 토큰 전달
 * 3. 섹션별 체류시간 자동 추적 (IntersectionObserver)
 * 4. 행동 로그 배치 전송 (5개마다 or 페이지 떠날 때)
 * 5. 전공 트랙 추천 요청
 * ================================================
 */

(function () {
  'use strict';

  const API_BASE = 'https://aiforalab.com/mediacom-api/api.php';
  const TOKEN_KEY = 'mediacom_token';
  const USER_KEY = 'mediacom_user';

  // ============================================
  // 1. 로그인/로그아웃 관리
  // ============================================

  function getStoredSession() {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
      if (token && user) return { token, user };
    } catch (e) { }
    return null;
  }

  function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    stopTracking();
  }

  async function login(studentId, name) {
    try {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', student_id: studentId, name: name })
      });
      const data = await res.json();
      if (data.success) {
        saveSession(data.token, data.user);
        updateUI(data.user);
        sendUserInfoToAvatar(data.user, data.token);
        startTracking();
        return { success: true, user: data.user };
      }
      return { success: false, error: data.error || '로그인 실패' };
    } catch (e) {
      return { success: false, error: '서버 연결 실패' };
    }
  }

  function logout() {
    // 떠나기 전 남은 로그 전송
    flushLogs();
    clearSession();
    updateUI(null);
    // 새로고침
    location.reload();
  }

  // ============================================
  // 2. UI 업데이트
  // ============================================

  function updateUI(user) {
    const badge = document.getElementById('user-badge');
    const logoutBtn = document.getElementById('logout-btn');
    const loginTrigger = document.getElementById('login-trigger');

    if (user) {
      if (badge) {
        badge.textContent = user.name + '님';
        badge.style.display = 'inline-block';
      }
      if (logoutBtn) logoutBtn.style.display = 'inline-block';
      if (loginTrigger) loginTrigger.style.display = 'none';
    } else {
      if (badge) badge.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (loginTrigger) loginTrigger.style.display = 'inline-block';
    }
  }

  // ============================================
  // 3. 아바타에 사용자 정보 + 토큰 전달
  // ============================================

  function sendUserInfoToAvatar(user, token) {
    const iframe = document.querySelector('iframe[src*="mediacom-avatar"]') ||
                   document.querySelector('iframe[src*="netlify"]');
    if (iframe) {
      iframe.contentWindow.postMessage({
        type: 'USER_INFO',
        user: { name: user.name, student_id: user.student_id },
        token: token || localStorage.getItem(TOKEN_KEY)
      }, '*');
      iframe.contentWindow.postMessage({ type: 'START_AVATAR' }, '*');
      console.log('📤 아바타에 사용자 정보 + 토큰 전달:', user.name);
    }
  }

  // iframe 로드 후에도 전달 (지연 로드 대응)
  function setupIframeListener() {
    const observer = new MutationObserver(function () {
      const session = getStoredSession();
      if (session) {
        sendUserInfoToAvatar(session.user, session.token);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // iframe load 이벤트
    document.addEventListener('load', function (e) {
      if (e.target && e.target.tagName === 'IFRAME') {
        const session = getStoredSession();
        if (session) {
          setTimeout(function () {
            sendUserInfoToAvatar(session.user, session.token);
          }, 1000);
        }
      }
    }, true);
  }

  // ============================================
  // 4. 섹션별 체류시간 추적 (IntersectionObserver)
  // ============================================

  var sectionTimers = {};      // { sectionId: { startTime, totalTime, isVisible } }
  var logBuffer = [];           // 배치 전송용 버퍼
  var trackingActive = false;
  var intersectionObserver = null;

  // 추적할 섹션 정의
  var TRACKED_SECTIONS = [
    'main',           // 메인 히어로
    'about',          // 전공소개
    'tab-media',      // 언론정보
    'tab-ad',         // 광고PR
    'tab-content',    // 영상콘텐츠
    'curriculum',     // 커리큘럼
    'career',         // 진로
    'admission',      // 입학안내
    'facilities',     // 시설
    'faculty',        // 교수진
    'news'            // 뉴스
  ];

  function startTracking() {
    if (trackingActive) return;
    trackingActive = true;

    // IntersectionObserver로 섹션 가시성 감지
    if ('IntersectionObserver' in window) {
      intersectionObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var id = entry.target.id || entry.target.dataset.section || 'unknown';
          
          if (entry.isIntersecting) {
            // 섹션이 보이기 시작
            if (!sectionTimers[id]) {
              sectionTimers[id] = { startTime: 0, totalTime: 0, isVisible: false };
            }
            sectionTimers[id].startTime = Date.now();
            sectionTimers[id].isVisible = true;
            console.log('👁️ 섹션 진입:', id);
          } else {
            // 섹션이 안 보이게 됨
            if (sectionTimers[id] && sectionTimers[id].isVisible) {
              var elapsed = (Date.now() - sectionTimers[id].startTime) / 1000;
              sectionTimers[id].totalTime += elapsed;
              sectionTimers[id].isVisible = false;

              // 2초 이상 체류한 경우만 로그
              if (elapsed >= 2) {
                addLog('section_view', id, { duration_seconds: Math.round(elapsed) });
              }
            }
          }
        });
      }, { threshold: 0.3 }); // 30% 이상 보일 때

      // 각 섹션에 observer 부착
      TRACKED_SECTIONS.forEach(function (sectionId) {
        var el = document.getElementById(sectionId);
        if (el) {
          intersectionObserver.observe(el);
        }
      });

      // data-section 속성이 있는 요소도 추적
      document.querySelectorAll('[data-section]').forEach(function (el) {
        intersectionObserver.observe(el);
      });
    }

    // 탭 클릭 추적
    document.addEventListener('click', handleTabClick);

    // 스크롤 깊이 추적 (10% 단위)
    var maxScrollDepth = 0;
    window.addEventListener('scroll', function () {
      if (!trackingActive) return;
      var scrollPercent = Math.round(
        (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
      );
      if (scrollPercent > maxScrollDepth && scrollPercent % 10 === 0) {
        maxScrollDepth = scrollPercent;
        addLog('scroll_depth', 'page', { depth_percent: scrollPercent });
      }
    });

    console.log('📊 행동 추적 시작');
  }

  function stopTracking() {
    trackingActive = false;
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    document.removeEventListener('click', handleTabClick);
  }

  function handleTabClick(e) {
    // 탭 버튼 클릭 감지
    var btn = e.target.closest('[data-tab], .tab-btn, .wf-tab');
    if (btn) {
      var tabId = btn.dataset.tab || btn.dataset.section || btn.textContent.trim().substring(0, 20);
      addLog('tab_click', tabId, {});
    }

    // 빠른 질문 버튼 클릭 감지
    var qBtn = e.target.closest('.quick-question-btn, [data-question]');
    if (qBtn) {
      var question = qBtn.dataset.question || qBtn.textContent.trim();
      addLog('quick_question', 'avatar', { question: question.substring(0, 100) });
    }
  }

  // ============================================
  // 5. 로그 버퍼 + 배치 전송
  // ============================================

  function addLog(eventType, sectionId, metadata) {
    logBuffer.push({
      event_type: eventType,
      section_id: sectionId,
      metadata: metadata,
      timestamp: new Date().toISOString()
    });

    // 5개 모이면 전송
    if (logBuffer.length >= 5) {
      flushLogs();
    }
  }

  function flushLogs() {
    if (logBuffer.length === 0) return;

    var session = getStoredSession();
    if (!session) return;

    var logsToSend = logBuffer.slice();
    logBuffer = [];

    // sendBeacon 사용 (페이지 떠날 때도 전송 보장)
    var payload = JSON.stringify({
      action: 'log_batch',
      token: session.token,
      events: logsToSend
    });

    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(API_BASE, blob);
      console.log('📤 로그 배치 전송 (beacon):', logsToSend.length + '건');
    } else {
      fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }).catch(function () { });
      console.log('📤 로그 배치 전송 (fetch):', logsToSend.length + '건');
    }
  }

  // 페이지 떠날 때 남은 로그 + 체류시간 전송
  window.addEventListener('beforeunload', function () {
    // 현재 보이는 섹션의 체류시간 마감
    Object.keys(sectionTimers).forEach(function (id) {
      if (sectionTimers[id].isVisible) {
        var elapsed = (Date.now() - sectionTimers[id].startTime) / 1000;
        if (elapsed >= 2) {
          addLog('section_view', id, { duration_seconds: Math.round(elapsed) });
        }
      }
    });

    // 총 페이지 체류시간
    if (window.__pageLoadTime) {
      var totalTime = Math.round((Date.now() - window.__pageLoadTime) / 1000);
      addLog('page_total', 'page', { total_seconds: totalTime });
    }

    flushLogs();
  });

  window.__pageLoadTime = Date.now();

  // ============================================
  // 6. 추천 요청
  // ============================================

  async function getRecommendations() {
    var session = getStoredSession();
    if (!session) return null;

    try {
      var res = await fetch(API_BASE + '?action=get_recommendations&token=' + session.token);
      var data = await res.json();
      return data.success ? data : null;
    } catch (e) {
      return null;
    }
  }

  async function getPrediction() {
    var session = getStoredSession();
    if (!session) return null;

    try {
      var res = await fetch(API_BASE + '?action=get_predict&token=' + session.token);
      var data = await res.json();
      return data.success ? data : null;
    } catch (e) {
      return null;
    }
  }

  // ============================================
  // 7. 로그인 모달 핸들러
  // ============================================

  function setupLoginModal() {
    var modal = document.getElementById('login-modal');
    var loginForm = document.getElementById('login-form');
    var loginBtn = document.querySelector('.login-submit');
    var guestBtn = document.getElementById('login-guest-btn');
    var logoutBtn = document.getElementById('logout-btn');

    // Form submit 핸들러 (기존 index.html이 form 방식)
    if (loginForm) {
      loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var studentId = document.getElementById('login-student-id').value.trim();
        var studentName = document.getElementById('login-name').value.trim();

        if (!studentId || !studentName) {
          alert('학번과 이름을 모두 입력해주세요.');
          return;
        }

        if (loginBtn) {
          loginBtn.disabled = true;
          loginBtn.textContent = '로그인 중...';
        }

        var result = await login(studentId, studentName);

        if (result.success) {
          if (modal) modal.classList.remove('active');
          console.log('✅ 로그인 성공:', result.user.name);
        } else {
          alert(result.error);
        }

        if (loginBtn) {
          loginBtn.disabled = false;
          loginBtn.textContent = '시작하기';
        }
      });
    }

    if (guestBtn) {
      guestBtn.addEventListener('click', function () {
        if (modal) modal.classList.remove('active');
        console.log('👤 게스트 입장');
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
    }

    // Enter 키 지원
    ['login-student-id', 'login-name'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('keypress', function (e) {
          if (e.key === 'Enter' && loginBtn) loginBtn.click();
        });
      }
    });
  }

  // ============================================
  // 8. 초기화
  // ============================================

  function init() {
    setupLoginModal();
    setupIframeListener();

    // 기존 세션 복원
    var session = getStoredSession();
    if (session) {
      // 토큰 유효성 검증
      fetch(API_BASE + '?action=verify&token=' + session.token)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.valid) {
            updateUI(session.user);
            startTracking();
            // 아바타에 정보 전달 (약간의 딜레이)
            setTimeout(function () {
              sendUserInfoToAvatar(session.user, session.token);
            }, 2000);
          } else {
            clearSession();
            updateUI(null);
            // 토큰 만료 → 로그인 모달 표시
            console.log('🔐 세션 만료, 재로그인 필요');
            setTimeout(function () {
              var modal = document.getElementById('login-modal');
              if (modal) modal.classList.add('active');
            }, 1000);
          }
        })
        .catch(function () {
          // 오프라인이면 일단 세션 유지
          updateUI(session.user);
        });
    } else {
      updateUI(null);
      // 3초 후 로그인 모달 표시
      setTimeout(function () {
        var modal = document.getElementById('login-modal');
        if (modal && !getStoredSession()) {
          modal.classList.add('active');
        }
      }, 3000);
    }
  }

  // DOM 준비되면 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 전역 API 노출 (디버깅 + 아바타 봇 연동용)
  window.MediaComAuth = {
    login: login,
    logout: logout,
    getSession: getStoredSession,
    getRecommendations: getRecommendations,
    getPrediction: getPrediction,
    flushLogs: flushLogs
  };

})();
