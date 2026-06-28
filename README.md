# 머니핏 (MoneyFit) — 실행 가이드

## 구조
```
landing/        홈페이지 (랜딩페이지) → 가입 유도, 요금제, 기능 소개
web/            설치형 앱 (PWA) → app.html, manifest.json, sw.js, icons/
server/         백엔드 (Node.js + Express) → 회원가입/로그인, 기록 저장, AI 분석 프록시
```
서버 하나가 세 가지를 동시에 서비스합니다:
- `/` → 랜딩페이지
- `/app/app.html` → 실제 앱 (로그인 후 사용, 홈화면에 설치 가능)
- `/api/*` → 백엔드 API

## 처음 실행하기 (로컬)

1. **Node.js 설치** (18 버전 이상): https://nodejs.org → LTS 버전 다운로드 후 설치
2. 터미널에서:
   ```
   cd server
   npm install
   copy .env.example .env
   ```
3. `.env` 파일을 열어 `ANTHROPIC_API_KEY`에 실제 Claude API 키를 넣고, `JWT_SECRET`도 임의의 긴 문자열로 바꾸기
4. 서버 실행:
   ```
   npm start
   ```
5. 브라우저에서 http://localhost:3000 접속 → 랜딩페이지 확인
6. "지금 시작하기" 클릭 → 회원가입 → 앱 사용

## 폰에 앱처럼 설치하기 (PWA)

1. 서버를 인터넷에 배포한 뒤(아래 배포 섹션 참고), 폰 크롬/사파리에서 `https://내도메인.com/app/app.html` 접속
2. 안드로이드(크롬): 우측 상단 메뉴 → "홈 화면에 추가"
3. 아이폰(사파리): 공유 버튼 → "홈 화면에 추가"
4. 홈 화면 아이콘으로 캐시노트처럼 바로 실행됨 (주소창 없이 전체 화면)

## 실제 배포 (대한민국 사용자가 접속 가능하게)

추천: **Render.com** 또는 **Railway.app** (무료 티어 있음, Node 앱 그대로 배포 가능)

1. 이 프로젝트 전체를 GitHub 저장소에 push
2. Render/Railway에서 "New Web Service" → 저장소 연결
3. Root Directory: `server`, Build Command: `npm install`, Start Command: `npm start`
4. 환경변수에 `ANTHROPIC_API_KEY`, `JWT_SECRET` 입력 (`.env` 내용 그대로)
5. 배포 완료 후 발급되는 주소(예: `https://moneyfit.onrender.com`)가 실제 서비스 주소
6. 도메인 연결하려면 가비아/후이즈 등에서 `.co.kr`이나 `.com` 구매 후 해당 서비스의 Custom Domain 설정에 연결

### 주의: 데이터 저장 방식
지금은 `server/data/db.json` 파일에 저장합니다(소규모 베타 테스트용). Render 무료 티어는 재배포 시 파일이 초기화될 수 있으니, 사용자가 늘어나면 PostgreSQL/MongoDB 같은 실제 DB로 교체가 필요합니다 — 데이터 구조(users/records)는 그대로 옮기면 됩니다.

## 보안 체크
- AI API 키는 서버(`server/.env`)에만 있고 클라이언트에는 절대 노출되지 않습니다 (`server/server.js`의 `callClaude` 참고)
- 비밀번호는 bcrypt로 해시 저장
- 모든 기록 API는 JWT 토큰으로 사용자별 접근 제한

## 다음 단계 (TASKS.md 참고)
- [ ] 영수증 촬영 → Claude Vision API 자동 인식 연결
- [ ] PostgreSQL 등 실 DB로 교체 (사용자 100명 이상 시)
- [ ] 아이콘을 PNG로 교체 (아이폰 홈화면 아이콘 선명도 개선)
- [ ] OKPOS/포스뱅크 연동
