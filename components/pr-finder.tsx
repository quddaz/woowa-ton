"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, RefreshCw, GitPullRequest, MessageSquare, ChevronDown, ChevronRight, Clock, Github, Info
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// Supabase 클라이언트
const supabase = createClient();

// Gemini API Key
const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const GEMINI_MODEL = process.env.NEXT_PUBLIC_GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';
const CURRENT_YEAR = new Date().getUTCFullYear();
const PR_DATE_CUTOFF = new Date(Date.UTC(CURRENT_YEAR, 0, 1, 0, 0, 0));

// GitHub Token (선택적)
const GITHUB_TOKEN = process.env.NEXT_PUBLIC_GITHUB_TOKEN;
const githubHeaders: Record<string, string> = {
  'Accept': 'application/vnd.github.v3+json',
  ...(GITHUB_TOKEN ? { 'Authorization': `Bearer ${GITHUB_TOKEN}` } : {})
};

const generateGeminiContent = async (payload: unknown) => {
  const primaryApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  let response = await fetch(primaryApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let result = await response.json();

  const isModelUnavailable =
    !response.ok &&
    typeof result?.error?.message === 'string' &&
    (result.error.message.includes('is not found') ||
      result.error.message.includes('is not supported'));

  if (isModelUnavailable && GEMINI_MODEL !== GEMINI_FALLBACK_MODEL) {
    const fallbackApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FALLBACK_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    response = await fetch(fallbackApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    result = await response.json();
  }

  if (!response.ok) {
    const apiMessage = result?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gemini API 요청 실패: ${apiMessage}`);
  }

  return result;
};


const extractHashtags = (text: string | null) => {
  if (!text) return ['기능구현'];
  const keywords = ['예외처리', 'RestControllerAdvice', '인터셉터', '도메인', 'DTO', '동시성', 'JPA', '테스트', 'Auth', '권한', '리팩터링', '인증', '인가', '세션', '쿠키', '상태패턴', '일급컬렉션'];
  const tags: string[] = [];
  keywords.forEach(kw => {
    if (text.toLowerCase().includes(kw.toLowerCase())) tags.push(kw);
  });
  if (tags.length === 0) tags.push('기능구현');
  return tags;
};


const GithubMergeIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="6" r="2.5" />
    <circle cx="7" cy="18" r="2.5" />
    <circle cx="17" cy="12" r="2.5" />
    <path d="M7 8.5v7" />
    <path d="M14.5 12H10c-1.657 0-3-1.343-3-3" />
  </svg>
);

interface PR {
  id: number;
  title: string;
  author: string;
  avatarUrl: string;
  mission: string;
  status: 'OPEN' | 'MERGED' | 'CLOSED';
  githubUrl: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  commentsUrl: string;
  reviewCommentsUrl: string;
  hashtags: string[];
}

interface Comment {
  id: number;
  reviewer: string;
  avatarUrl: string;
  content: string;
  created_at: string;
  isReply: boolean;
  codeContext?: string;
  codePath?: string;
}

interface ImportantComment {
  id: number;
  reviewer: string;
  avatarUrl: string;
  content: string;
  reason: string;
  created_at: string;
}

interface Summary {
  text: string;
  cached: boolean;
}

interface ImportantCommentsData {
  comments: ImportantComment[];
  cached: boolean;
}

export default function PRFinder() {
  const [prs, setPrs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'OPEN' | 'MERGED'>('OPEN');
  const [expandedPrId, setExpandedPrId] = useState<number | null>(null);

  const [commentsData, setCommentsData] = useState<Record<number, Comment[]>>({});
  const [loadingComments, setLoadingComments] = useState<Record<number, boolean>>({});
  const [commentErrors, setCommentErrors] = useState<Record<number, string | null>>({});

  const [summaries, setSummaries] = useState<Record<number, Summary>>({});
  const [loadingSummaries, setLoadingSummaries] = useState<Record<number, boolean>>({});

  // 중요 코멘트 관련 상태
  const [importantComments, setImportantComments] = useState<Record<number, ImportantCommentsData>>({});
  const [loadingImportantComments, setLoadingImportantComments] = useState<Record<number, boolean>>({});
  const [showImportantOnly, setShowImportantOnly] = useState<Record<number, boolean>>({});
  const [changesRequestedAtMap, setChangesRequestedAtMap] = useState<Record<number, string | null>>({});

  useEffect(() => {
    const fetchPRs = async () => {
      try {
        setLoading(true);
        const response = await fetch('https://api.github.com/repos/woowacourse/spring-roomescape-member/pulls?state=all&sort=updated&direction=desc&per_page=40', {
          headers: githubHeaders
        });
        
        if (!response.ok) {
          throw new Error('GitHub API 호출에 실패했습니다. (API 요청 횟수 제한 초과일 수 있습니다)');
        }
        
        const data = await response.json();
        
        const formattedPrs: PR[] = data.map((pr: {
          number: number;
          title: string;
          user: { login: string; avatar_url: string };
          state: string;
          merged_at: string | null;
          html_url: string;
          body: string | null;
          created_at: string;
          updated_at: string;
          comments_url: string;
          review_comments_url: string;
        }) => ({
          id: pr.number,
          title: pr.title,
          author: pr.user.login,
          avatarUrl: pr.user.avatar_url,
          mission: 'spring-roomescape-member',
          status: pr.state === 'open' ? 'OPEN' : (pr.merged_at ? 'MERGED' : 'CLOSED'),
          githubUrl: pr.html_url,
          body: pr.body || 'PR 본문 내용이 없습니다.',
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          commentsUrl: pr.comments_url,
          reviewCommentsUrl: pr.review_comments_url,
          hashtags: extractHashtags(pr.title + ' ' + pr.body)
        })).filter((pr: PR) => pr.status !== 'CLOSED' && new Date(pr.createdAt) >= PR_DATE_CUTOFF);

        setPrs(formattedPrs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchPRs();
  }, []);

  const generateSummary = async (pr: PR) => {
    if (summaries[pr.id] || loadingSummaries[pr.id]) return;

    if (!pr.body || pr.body.length < 20) {
      setSummaries(prev => ({ ...prev, [pr.id]: { text: "- 요약할 본문 내용이 충분하지 않습니다.", cached: false } }));
      return;
    }

    setLoadingSummaries(prev => ({ ...prev, [pr.id]: true }));
    try {
      // 1. Supabase에서 캐시된 요약 조회
      const { data: cachedData, error: fetchError } = supabase
        ? await supabase
            .from('pr_summaries')
            .select('*')
            .eq('pr_number', pr.id)
            .single()
        : { data: null, error: new Error('Supabase client unavailable') };

      let currentSummary: string | null = null;
      let isCached = false;
      let needsUpdate = true;

      // 2. DB 캐시가 존재하면 AI를 호출하지 않고 즉시 사용
      if (!fetchError && cachedData?.summary) {
        currentSummary = cachedData.summary;
        isCached = true;
        needsUpdate = false;
      }

      // 3. 캐시가 없거나 PR이 갱신되었다면 Gemini AI 호출
      if (needsUpdate && GEMINI_API_KEY) {
        const systemPrompt = `다음 Pull Request 본문 내용을 분석해서, PR 작성자가 리뷰어에게 피드백을 요청하는 사항(고민점, 아쉬운 점, 중점 리뷰 요청 등)을 3가지 이내로 요약해.
만약 명시적인 질문이 없다면 리뷰어가 중점적으로 봐야할 부분을 유추해서 작성해.
주의: '시니어 백엔드 시선에서', '요약해 드리겠습니다' 등의 서론이나 불필요한 수식어 없이, 곧바로 마크다운 bullet point(-) 형식의 결과만 간결하게 출력해.`;
        const userQuery = `PR 본문:\n${pr.body}`;
        const payload = {
          contents: [{ parts: [{ text: userQuery }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        const result = await generateGeminiContent(payload);
        const candidate = result.candidates?.[0];

        if (candidate && candidate.content?.parts?.[0]?.text) {
          currentSummary = candidate.content.parts[0].text;
          isCached = false;

          // 4. 새 요약을 Supabase에 저장 (upsert)
          if (supabase) {
            await supabase
              .from('pr_summaries')
              .upsert({
                pr_number: pr.id,
                pr_title: pr.title,
                summary: currentSummary,
                updated_at: new Date().toISOString()
              }, { onConflict: 'pr_number' });
          }
        } else {
          throw new Error("API 요약 응답 오류");
        }
      } else if (needsUpdate && !GEMINI_API_KEY) {
        currentSummary = "- Gemini API 키가 설정되지 않았습니다.";
        isCached = false;
      }

      if (currentSummary) {
        setSummaries(prev => ({ ...prev, [pr.id]: { text: currentSummary!, cached: isCached } }));
      }
    } catch (error) {
      console.error("AI 요약/DB 처리 실패:", error);
      const errorMessage = error instanceof Error ? error.message : "요약 생성 또는 조회 중 오류가 발생했습니다.";
      setSummaries(prev => ({ ...prev, [pr.id]: { text: errorMessage, cached: false } }));
    } finally {
      setLoadingSummaries(prev => ({ ...prev, [pr.id]: false }));
    }
  };

  const fetchChangesRequestedAt = async (pr: PR) => {
    if (changesRequestedAtMap[pr.id] !== undefined) return changesRequestedAtMap[pr.id];

    const reviewsResponse = await fetch(
      `https://api.github.com/repos/woowacourse/spring-roomescape-member/pulls/${pr.id}/reviews`,
      { headers: githubHeaders }
    );
    const reviews = await reviewsResponse.json();
    const changesRequestedReviews = Array.isArray(reviews)
      ? reviews.filter((r: { state: string }) => r.state === 'CHANGES_REQUESTED')
      : [];

    const latestChangesRequested = changesRequestedReviews.length > 0
      ? changesRequestedReviews.reduce((latest: { submitted_at: string }, r: { submitted_at: string }) =>
          new Date(r.submitted_at) > new Date(latest.submitted_at) ? r : latest
        )
      : null;

    const changesRequestedAt = latestChangesRequested?.submitted_at || null;
    setChangesRequestedAtMap(prev => ({ ...prev, [pr.id]: changesRequestedAt }));
    return changesRequestedAt;
  };

  // 중요 코멘트 필터링 함수
  const filterImportantComments = async (pr: PR, allComments: Comment[]) => {
    if (loadingImportantComments[pr.id] || allComments.length === 0) return;

    setLoadingImportantComments(prev => ({ ...prev, [pr.id]: true }));

    try {
      // 2. Supabase에서 캐시된 중요 코멘트 조회
      const { data: cachedData, error: fetchError } = supabase
        ? await supabase
            .from('pr_important_comments')
            .select('*')
            .eq('pr_number', pr.id)
            .single()
        : { data: null, error: new Error('Supabase client unavailable') };

      let needsUpdate = true;

      // 3. DB 캐시가 존재하면 AI를 호출하지 않고 즉시 사용
      if (!fetchError && cachedData?.important_comments) {
        setImportantComments(prev => ({
          ...prev,
          [pr.id]: { comments: cachedData.important_comments as ImportantComment[], cached: true }
        }));
        needsUpdate = false;
      }

      const changesRequestedAt = needsUpdate ? await fetchChangesRequestedAt(pr) : null;

      // 4. 갱신 필요 시 AI로 중요 코멘트 필터링
      if (needsUpdate && GEMINI_API_KEY) {
        const commentsText = allComments
          .filter(c => !c.isReply)
          .map(c => `[ID:${c.id}] ${c.reviewer}: ${c.content}`)
          .join('\n\n---\n\n');

        const systemPrompt = `다음은 코드 리뷰 코멘트 목록입니다. 이 중에서 학습에 도움이 되는 중요한 코멘트만 선별해주세요.

중요한 코멘트 기준:
1. 코드 품질 개선 제안 (리팩터링, 클린 코드)
2. 버그나 잠재적 문제점 지적
3. 성능 개선 제안
4. 설계 패턴이나 아키텍처 관련 조언
5. 베스트 프랙티스 관련 피드백

제외할 코멘트:
- 단순 승인이나 칭찬 ("LGTM", "좋습니다" 등)
- 오타 지적
- 사소한 포맷팅 관련 코멘트

응답 형식 (JSON 배열):
[
  {"id": 코멘트ID숫자, "reason": "선별 이유 (10자 내외)"},
  ...
]

중요한 코멘트가 없으면 빈 배열 []을 반환하세요.
반드시 유효한 JSON만 출력하세요. 다른 텍스트는 포함하지 마세요.`;

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const payload = {
          contents: [{ parts: [{ text: commentsText }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        const result = await generateGeminiContent(payload);
        const candidate = result.candidates?.[0];

        if (candidate && candidate.content?.parts?.[0]?.text) {
          const responseText = candidate.content.parts[0].text.trim();
          
          // JSON 파싱 시도
          let selectedIds: { id: number; reason: string }[] = [];
          try {
            // 코드 블록이 있으면 제거
            const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
            selectedIds = JSON.parse(jsonText);
          } catch {
            console.error("JSON 파싱 실패:", responseText);
            selectedIds = [];
          }

          // 선택된 ID로 코멘트 필터링
          const importantList: ImportantComment[] = selectedIds
            .map(sel => {
              const comment = allComments.find(c => c.id === sel.id);
              if (comment) {
                return {
                  id: comment.id,
                  reviewer: comment.reviewer,
                  avatarUrl: comment.avatarUrl,
                  content: comment.content,
                  reason: sel.reason,
                  created_at: comment.created_at
                };
              }
              return null;
            })
            .filter((c): c is ImportantComment => c !== null);

          // 5. Supabase에 저장 (upsert)
          if (supabase) {
            await supabase
              .from('pr_important_comments')
              .upsert({
                pr_number: pr.id,
                important_comments: importantList,
                changes_requested_at: changesRequestedAt,
                updated_at: new Date().toISOString()
              }, { onConflict: 'pr_number' });
          }

          setImportantComments(prev => ({
            ...prev,
            [pr.id]: { comments: importantList, cached: false }
          }));
        }
      } else if (needsUpdate && !GEMINI_API_KEY) {
        setImportantComments(prev => ({
          ...prev,
          [pr.id]: { comments: [], cached: false }
        }));
      }
    } catch (error) {
      console.error("중요 코멘트 필터링 실패:", error);
    } finally {
      setLoadingImportantComments(prev => ({ ...prev, [pr.id]: false }));
    }
  };

  const togglePR = async (pr: PR) => {
    if (expandedPrId === pr.id) {
      setExpandedPrId(null);
      return;
    }
    
    setExpandedPrId(pr.id);
    await fetchChangesRequestedAt(pr);
    generateSummary(pr);

    if (commentsData[pr.id]) {
      // 이미 코멘트가 있으면 중요 코멘트만 필터링
      if (!importantComments[pr.id] && !loadingImportantComments[pr.id]) {
        filterImportantComments(pr, commentsData[pr.id]);
      }
      return;
    }

    try {
      setLoadingComments(prev => ({ ...prev, [pr.id]: true }));
      setCommentErrors(prev => ({ ...prev, [pr.id]: null }));
      
      const [issueRes, reviewRes] = await Promise.all([
        fetch(pr.commentsUrl, { headers: githubHeaders }),
        fetch(pr.reviewCommentsUrl, { headers: githubHeaders })
      ]);
      
      const issueComments = await issueRes.json();
      const reviewComments = await reviewRes.json();

      if (issueComments.message?.includes('rate limit') || reviewComments.message?.includes('rate limit') || issueComments.message?.includes('API rate limit')) {
        throw new Error('GitHub API 요청 제한(1시간 60회)을 초과했습니다. 1시간 뒤에 다시 시도해주세요.');
      }

      const issueCommentsList = Array.isArray(issueComments) ? issueComments : [];
      const reviewCommentsList = Array.isArray(reviewComments) ? reviewComments : [];

      const threadMap = new Map<number, { root: typeof reviewCommentsList[0] | null; replies: typeof reviewCommentsList }>();

      reviewCommentsList.forEach((c: { id: number; in_reply_to_id?: number }) => {
        const rootId = c.in_reply_to_id || c.id;
        if (!threadMap.has(rootId)) {
          threadMap.set(rootId, { root: null, replies: [] });
        }
        
        if (c.id === rootId) {
          threadMap.get(rootId)!.root = c;
        } else {
          threadMap.get(rootId)!.replies.push(c);
        }
      });

      const finalReviewThreads: { root: typeof reviewCommentsList[0]; replies: typeof reviewCommentsList }[] = [];
      for (const [, thread] of threadMap.entries()) {
        if (thread.root) {
          finalReviewThreads.push(thread as { root: typeof reviewCommentsList[0]; replies: typeof reviewCommentsList });
        } else if (thread.replies.length > 0) {
          thread.replies.sort((a: { created_at: string }, b: { created_at: string }) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          thread.root = thread.replies.shift()!;
          finalReviewThreads.push(thread as { root: typeof reviewCommentsList[0]; replies: typeof reviewCommentsList });
        }
      }

      const issueThreads = issueCommentsList.map((c: typeof issueCommentsList[0]) => ({ root: c, replies: [] }));

      const allThreads = [...issueThreads, ...finalReviewThreads];
      allThreads.sort((a, b) => new Date(a.root.created_at).getTime() - new Date(b.root.created_at).getTime());

      const formattedComments: Comment[] = [];
      allThreads.forEach(thread => {
        if (!thread.root) return;
        
        formattedComments.push({
          id: thread.root.id,
          reviewer: thread.root.user?.login || 'unknown',
          avatarUrl: thread.root.user?.avatar_url,
          content: thread.root.body,
          created_at: thread.root.created_at,
          isReply: false,
          codeContext: typeof thread.root.diff_hunk === 'string' ? thread.root.diff_hunk : undefined,
          codePath: typeof thread.root.path === 'string' ? thread.root.path : undefined
        });

        thread.replies.sort((a: { created_at: string }, b: { created_at: string }) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        thread.replies.forEach((reply: { id: number; user?: { login: string; avatar_url: string }; body: string; created_at: string; diff_hunk?: string; path?: string }) => {
          formattedComments.push({
            id: reply.id,
            reviewer: reply.user?.login || 'unknown',
            avatarUrl: reply.user?.avatar_url || '',
            content: reply.body,
            created_at: reply.created_at,
            isReply: true,
            codeContext: typeof reply.diff_hunk === 'string' ? reply.diff_hunk : undefined,
            codePath: typeof reply.path === 'string' ? reply.path : undefined
          });
        });
      });

      setCommentsData(prev => ({ ...prev, [pr.id]: formattedComments }));
      
      // 코멘트 로드 후 중요 코멘트 필터링
      filterImportantComments(pr, formattedComments);
    } catch (error) {
      console.error('코멘트 로딩 중 에러:', error);
      setCommentErrors(prev => ({ ...prev, [pr.id]: error instanceof Error ? error.message : 'Unknown error' }));
    } finally {
      setLoadingComments(prev => ({ ...prev, [pr.id]: false }));
    }
  };

  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(new Date());

  const handleSync = () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setTimeout(() => { setLastSyncTime(new Date()); setIsSyncing(false); }, 800);
  };

  const openCount = prs.filter(pr => pr.status === 'OPEN').length;
  const mergedCount = prs.filter(pr => pr.status === 'MERGED').length;

  const filteredPRs = useMemo(() => {
    return prs.filter(pr => {
      const matchesSearch = pr.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            pr.author.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTab = pr.status === activeTab;
      return matchesSearch && matchesTab;
    });
  }, [prs, searchTerm, activeTab]);

  // 표시할 코멘트 결정
  const getDisplayComments = (prId: number): Comment[] => {
    if (showImportantOnly[prId] && importantComments[prId]) {
      // 중요 코멘트만 표시할 때는 ImportantComment를 Comment 형태로 변환
      return importantComments[prId].comments.map(ic => ({
        id: ic.id,
        reviewer: ic.reviewer,
        avatarUrl: ic.avatarUrl,
        content: ic.content,
        created_at: ic.created_at,
        isReply: false
      }));
    }
    return commentsData[prId] || [];
  };

  const timeAgoString = (iso: string) => {
    const date = new Date(iso);
    const diffMins = Math.round((Date.now() - date.getTime()) / 60000);
    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffMins < 1440) return `${Math.floor(diffMins/60)}시간 전`;
    return `${Math.floor(diffMins/1440)}일 전`;
  };

  return (
    <div className="min-h-screen bg-white text-[#1f2328] font-sans pb-12">
      <header className="bg-[#f6f8fa] border-b border-[#d0d7de] sticky top-0 z-20">
        <div className="max-w-[1280px] mx-auto px-4 h-[60px] flex items-center justify-between">
          <div className="flex items-center gap-3"><Github className="w-8 h-8" /><div className="font-semibold text-sm">woowacourse / spring-roomescape-member</div></div>
          <button onClick={handleSync} className="flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs"><RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}/>Sync</button>
        </div>
      </header>
      <main className="max-w-[1280px] mx-auto px-4 py-6">
        <div className="flex gap-2 mb-4"><div className="relative w-full max-w-[600px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[#656d76]"/><input className="w-full pl-9 pr-3 py-1.5 border rounded-md" placeholder="search" value={searchTerm} onChange={(e)=>setSearchTerm(e.target.value)} /></div></div>
        <div className="border rounded-md overflow-hidden">
          <div className="bg-[#f6f8fa] border-b px-4 py-3 flex gap-4">
            <button onClick={()=>setActiveTab('OPEN')} className="flex items-center gap-1.5"><GitPullRequest className="w-4 h-4 text-[#1a7f37]"/>{openCount} Open</button>
            <button onClick={()=>setActiveTab('MERGED')} className="flex items-center gap-1.5"><GithubMergeIcon className="w-4 h-4 text-[#8250df]"/>{mergedCount} Merged</button>
          </div>
          <div className="divide-y">
            {filteredPRs.map((pr)=>{ const isExpanded=expandedPrId===pr.id; const displayComments=getDisplayComments(pr.id); return <div key={pr.id}><div className="px-4 py-3 hover:bg-[#f6f8fa] cursor-pointer flex items-start gap-3" onClick={()=>togglePR(pr)}><div className="mt-1">{pr.status==='OPEN'?<GitPullRequest className="w-4 h-4 text-[#1a7f37]"/>:<GithubMergeIcon className="w-4 h-4 text-[#8250df]"/>}</div><div className="flex-1"><div className="flex justify-between"><h3 className="font-semibold">{pr.title}</h3><div className="flex items-center gap-3"><MessageSquare className="w-4 h-4"/>{isExpanded?<ChevronDown className="w-4 h-4"/>:<ChevronRight className="w-4 h-4"/>}</div></div><div className="text-xs text-[#656d76]">#{pr.id} {pr.status==='MERGED'?'merged':'opened'} {timeAgoString(pr.createdAt)} by {pr.author}</div></div></div>{isExpanded && <div className="px-4 pb-6"><div className="border rounded-md p-4 my-4"><div className="flex items-center gap-1 text-xs text-[#656d76] mb-2"><Info className="w-3 h-3"/>AI Summary</div><pre className="whitespace-pre-wrap text-sm">{loadingSummaries[pr.id]?'요약 중...':(summaries[pr.id]?.text || '-')}</pre></div>{loadingComments[pr.id]&&<div>comments loading...</div>}{commentErrors[pr.id]&&<div className="text-red-600 text-sm">{commentErrors[pr.id]}</div>}<div className="space-y-3">{displayComments.map(c=><div key={c.id} className="border rounded-md p-3"><div className="text-xs text-[#656d76]">{c.reviewer} · {timeAgoString(c.created_at)}</div><div className="text-sm whitespace-pre-wrap">{c.content}</div></div>)}</div></div>}</div>})}
          </div>
        </div>
      </main>
    </div>
  );
}