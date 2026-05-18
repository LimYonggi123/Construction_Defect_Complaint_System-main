import AppShell from './AppShell.jsx';

export default function AuthView({ authView, authData, setAuthView, setAuthData, onSubmit }) {
  const isLogin = authView === 'login';

  return (
    <AppShell variant="auth">
      <main className="auth-layout auth-layout-single">
        <section className="auth-panel" aria-label={isLogin ? '로그인' : '회원가입'}>
          <div className="panel-header">
            <p className="eyebrow">{isLogin ? 'Welcome back' : 'Create account'}</p>
            <h2>{isLogin ? '로그인' : '회원가입'}</h2>
          </div>

          <div className="form-stack">
            {!isLogin && (
              <label className="field">
                <span>이름</span>
                <input
                  placeholder="홍길동"
                  value={authData.name}
                  onChange={(event) => setAuthData({ ...authData, name: event.target.value })}
                />
              </label>
            )}
            <label className="field">
              <span>아이디</span>
              <input
                placeholder="아이디 입력"
                value={authData.userid}
                onChange={(event) => setAuthData({ ...authData, userid: event.target.value })}
              />
            </label>
            <label className="field">
              <span>비밀번호</span>
              <input
                type="password"
                placeholder="비밀번호 입력"
                value={authData.password}
                onChange={(event) => setAuthData({ ...authData, password: event.target.value })}
              />
            </label>
            <button className="button button-primary" onClick={onSubmit}>
              {isLogin ? '로그인' : '가입하기'}
            </button>
            <button className="button button-text" onClick={() => setAuthView(isLogin ? 'signup' : 'login')}>
              {isLogin ? '계정이 없으신가요? 회원가입' : '이미 계정이 있나요? 로그인'}
            </button>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
