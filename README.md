# PR-Explorer (코드리뷰 인사이트 대시보드)

우아한테크코스 `spring-roomescape-member` 저장소의 PR/리뷰 코멘트를 한 곳에서 탐색하고, AI 요약으로 학습 포인트를 빠르게 파악할 수 있는 웹 서비스입니다.

## 핵심 기능

- **PR 통합 조회**: Open/Merged PR을 한 화면에서 필터링하고 검색할 수 있습니다.
- **코드리뷰 코멘트 모아보기**: PR별 일반 코멘트/리뷰 코멘트를 통합 조회합니다.
- **AI PR 본문 요약**: Gemini를 이용해 PR 작성자의 고민점·리뷰 요청 포인트를 요약합니다.
- **중요 코멘트 선별**: 리뷰 코멘트 중 학습 가치가 높은 코멘트를 AI가 골라 보여줍니다.
- **캐시 기반 최적화**: Supabase에 요약/중요 코멘트를 저장해 재호출 비용과 시간을 줄입니다.

## 기술 스택

- **Framework**: Next.js 16, React 19, TypeScript
- **UI**: Tailwind CSS, Radix UI, Lucide Icons
- **Data/API**: GitHub REST API
- **AI**: Google Gemini API
- **Storage/Cache**: Supabase

## 실행 방법

### 1) 의존성 설치

```bash
npm install
```

### 2) 환경 변수 설정

프로젝트 루트에 `.env.local` 파일을 만들고 아래 값을 설정하세요.

```bash
# GitHub API (선택)
NEXT_PUBLIC_GITHUB_TOKEN=your_github_token

# Gemini API (요약/중요 코멘트 기능 사용 시 필요)
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
NEXT_PUBLIC_GEMINI_MODEL=gemini-2.5-flash-lite

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3) 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속하세요.

## 스크립트

- `npm run dev`: 개발 서버 실행
- `npm run build`: 프로덕션 빌드
- `npm run start`: 프로덕션 서버 실행
- `npm run lint`: 정적 분석 실행

## 프로젝트 구조 (요약)

- `app/page.tsx`: 엔트리 페이지
- `components/pr-finder.tsx`: 핵심 UI 및 PR/리뷰/AI 로직
- `lib/supabase/*`: Supabase 클라이언트

## 향후 개선 아이디어

- 저장소/브랜치/기간을 사용자가 직접 선택하는 멀티 리포 모드
- 미션/태그 기반 추천 PR 큐레이션
- 리뷰어별 피드백 스타일 분석 리포트
