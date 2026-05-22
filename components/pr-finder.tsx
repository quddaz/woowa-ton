"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Github, MessageSquare, X, AlertCircle,
  GitPullRequest, GitMerge, Check, ChevronRight, Sparkles, Loader2, Bot, Filter
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { createClient } from '@/lib/supabase/client';

// Supabase 클라이언트
const supabase = createClient();

// Gemini API Key
const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

// GitHub Token (선택적)
const GITHUB_TOKEN = process.env.NEXT_PUBLIC_GITHUB_TOKEN;
const githubHeaders: Record<string, string> = {
  'Accept': 'application/vnd.github.v3+json',
  ...(GITHUB_TOKEN ? { 'Authorization': `Bearer ${GITHUB_TOKEN}` } : {})
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

interface PR {
  id: number;
  title: string;
  author: string;
  avatarUrl: string;
  mission: string;
  status: 'OPEN' | 'MERGED' | 'CLOSED';
  githubUrl: string;
  body: string;
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

  useEffect(() => {
    const fetchPRs = async () => {
      try {
        setLoading(true);
        const response = await fetch('https://api.github.com/repos/woowacourse/spring-roomescape-member/pulls?state=all&per_page=40', {
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
          updatedAt: pr.updated_at,
          commentsUrl: pr.comments_url,
          reviewCommentsUrl: pr.review_comments_url,
          hashtags: extractHashtags(pr.title + ' ' + pr.body)
        })).filter((pr: PR) => pr.status !== 'CLOSED');

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

      // 2. 캐시가 존재하고 PR이 수정되지 않았으면 캐시 사용
      if (!fetchError && cachedData) {
        const cachedUpdatedAt = new Date(cachedData.updated_at).getTime();
        const prUpdatedAt = new Date(pr.updatedAt).getTime();
        
        if (cachedUpdatedAt >= prUpdatedAt) {
          currentSummary = cachedData.summary;
          isCached = true;
          needsUpdate = false;
        }
      }

      // 3. 캐시가 없거나 PR이 갱신되었다면 Gemini AI 호출
      if (needsUpdate && GEMINI_API_KEY) {
        const systemPrompt = `다음 Pull Request 본문 내용을 분석해서, PR 작성자가 리뷰어에게 피드백을 요청하는 사항(고민점, 아쉬운 점, 중점 리뷰 요청 등)을 3가지 이내로 요약해.
만약 명시적인 질문이 없다면 리뷰어가 중점적으로 봐야할 부분을 유추해서 작성해.
주의: '시니어 백엔드 시선에서', '요약해 드리겠습니다' 등의 서론이나 불필요한 수식어 없이, 곧바로 마크다운 bullet point(-) 형식의 결과만 간결하게 출력해.`;
        const userQuery = `PR 본문:\n${pr.body}`;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=${GEMINI_API_KEY}`;

        const payload = {
          contents: [{ parts: [{ text: userQuery }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
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
      setSummaries(prev => ({ ...prev, [pr.id]: { text: "요약 생성 또는 조회 중 오류가 발생했습니다.", cached: false } }));
    } finally {
      setLoadingSummaries(prev => ({ ...prev, [pr.id]: false }));
    }
  };

  // 중요 코멘트 필터링 함수
  const filterImportantComments = async (pr: PR, allComments: Comment[]) => {
    if (loadingImportantComments[pr.id] || allComments.length === 0) return;

    setLoadingImportantComments(prev => ({ ...prev, [pr.id]: true }));

    try {
      // 1. GitHub Reviews API로 CHANGES_REQUESTED 시간 확인
      const reviewsResponse = await fetch(
        `https://api.github.com/repos/woowacourse/spring-roomescape-member/pulls/${pr.id}/reviews`,
        { headers: githubHeaders }
      );
      const reviews = await reviewsResponse.json();
      
      // 가장 최근 CHANGES_REQUESTED 리뷰 시간 찾기
      const changesRequestedReviews = Array.isArray(reviews) 
        ? reviews.filter((r: { state: string }) => r.state === 'CHANGES_REQUESTED')
        : [];
      
      const latestChangesRequested = changesRequestedReviews.length > 0
        ? changesRequestedReviews.reduce((latest: { submitted_at: string }, r: { submitted_at: string }) => 
            new Date(r.submitted_at) > new Date(latest.submitted_at) ? r : latest
          )
        : null;

      const changesRequestedAt = latestChangesRequested?.submitted_at || null;

      // 2. Supabase에서 캐시된 중요 코멘트 조회
      const { data: cachedData, error: fetchError } = supabase
        ? await supabase
            .from('pr_important_comments')
            .select('*')
            .eq('pr_number', pr.id)
            .single()
        : { data: null, error: new Error('Supabase client unavailable') };

      let needsUpdate = true;

      // 3. 캐시가 존재하고 changes_requested_at이 동일하면 캐시 사용
      if (!fetchError && cachedData) {
        const cachedChangesAt = cachedData.changes_requested_at;
        
        if (cachedChangesAt === changesRequestedAt || 
            (!changesRequestedAt && !cachedChangesAt) ||
            (cachedChangesAt && changesRequestedAt && 
             new Date(cachedChangesAt).getTime() === new Date(changesRequestedAt).getTime())) {
          setImportantComments(prev => ({
            ...prev,
            [pr.id]: { comments: cachedData.important_comments as ImportantComment[], cached: true }
          }));
          needsUpdate = false;
        }
      }

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

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=${GEMINI_API_KEY}`;

        const payload = {
          contents: [{ parts: [{ text: commentsText }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
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
          isReply: false
        });

        thread.replies.sort((a: { created_at: string }, b: { created_at: string }) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        thread.replies.forEach((reply: { id: number; user?: { login: string; avatar_url: string }; body: string; created_at: string }) => {
          formattedComments.push({
            id: reply.id,
            reviewer: reply.user?.login || 'unknown',
            avatarUrl: reply.user?.avatar_url || '',
            content: reply.body,
            created_at: reply.created_at,
            isReply: true
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

  return (
    <div className="min-h-screen bg-[#f6f8fa] font-sans text-slate-900">
      <header className="bg-[#24292f] py-4 px-4 sm:px-6 lg:px-8 flex items-center gap-4 shadow-sm relative z-10">
        <div className="bg-white p-1 rounded-full">
          <Github className="w-6 h-6 text-[#24292f]" />
        </div>
        <h1 className="text-lg font-semibold text-white tracking-tight flex items-center">
          PR Finder 
          <span className="text-[10px] font-bold bg-blue-500 text-white px-2 py-0.5 rounded-full ml-3 tracking-wide">LIVE DATA</span>
          <span className="text-[10px] font-bold bg-indigo-500 text-white px-2 py-0.5 rounded-full ml-2 flex items-center gap-1 tracking-wide">
            <Sparkles className="w-3 h-3" /> AI POWERED
          </span>
        </h1>
        <p className="text-sm text-slate-300 ml-auto hidden md:block">
          우테코 백엔드 크루들의 의미 있는 리뷰 탐색기
        </p>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex gap-3">
          <div className="relative flex-1 shadow-sm group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            </div>
            <input
              type="text"
              className="block w-full pl-9 pr-8 py-2.5 bg-white border border-slate-300 rounded-lg text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
              placeholder="PR 제목 또는 작성자(GitHub ID)로 검색해보세요..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                <X className="h-4 w-4 text-slate-400 hover:text-slate-600 transition-colors" />
              </button>
            )}
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
          <div className="bg-[#f6f8fa] border-b border-slate-200 px-2 py-2 flex items-center gap-2 text-sm">
            <button 
              onClick={() => { setActiveTab('OPEN'); setExpandedPrId(null); }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md font-semibold transition-all ${
                activeTab === 'OPEN' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 border border-transparent'
              }`}
            >
              <GitPullRequest className="w-4 h-4" />
              {loading ? '-' : openCount} Open
            </button>
            <button 
              onClick={() => { setActiveTab('MERGED'); setExpandedPrId(null); }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md font-semibold transition-all ${
                activeTab === 'MERGED' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 border border-transparent'
              }`}
            >
              <Check className="w-4 h-4" />
              {loading ? '-' : mergedCount} Merged
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {loading ? (
              <div className="py-24 flex flex-col items-center justify-center text-slate-500 bg-white">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-blue-500" />
                <p>GitHub API에서 실시간 PR 목록을 동기화 중입니다...</p>
              </div>
            ) : error ? (
              <div className="py-16 text-center text-red-500 bg-white px-4">
                <AlertCircle className="w-8 h-8 mx-auto mb-3" />
                <h3 className="text-base font-medium mb-1">데이터를 불러올 수 없습니다.</h3>
                <p className="text-sm">{error}</p>
              </div>
            ) : filteredPRs.length > 0 ? (
              filteredPRs.map((pr) => (
                <div key={pr.id} className="group bg-white flex flex-col transition-colors duration-200">
                  <div 
                    className="p-4 hover:bg-blue-50/30 transition-colors flex items-start gap-3 cursor-pointer"
                    onClick={() => togglePR(pr)}
                  >
                    <div className="pt-0.5 shrink-0">
                      {pr.status === 'OPEN' 
                        ? <GitPullRequest className="w-5 h-5 text-[#1a7f37]" />
                        : <GitMerge className="w-5 h-5 text-[#8250df]" />
                      }
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-2 mb-1.5">
                        <h3 className="text-[15px] font-semibold text-slate-900 group-hover:text-blue-600 transition-colors truncate max-w-full">
                          {pr.title}
                        </h3>
                        <div className={`flex gap-1.5 ${expandedPrId === pr.id ? 'hidden' : 'flex'}`}>
                          {pr.hashtags.slice(0, 3).map((tag, idx) => (
                            <span key={idx} className="text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-100/50 px-2 py-0.5 rounded-full">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="text-xs text-slate-500 flex items-center gap-1.5">
                        <img src={pr.avatarUrl} alt={pr.author} className="w-4 h-4 rounded-full border border-slate-200" />
                        <span>#{pr.id} {pr.status === 'OPEN' ? 'opened' : 'merged'} by <span className="hover:text-blue-600 font-medium text-slate-700">{pr.author}</span></span>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center text-slate-400 mt-1">
                      <ChevronRight className={`w-5 h-5 transition-transform duration-200 ${expandedPrId === pr.id ? 'rotate-90 text-blue-500' : 'group-hover:translate-x-1'}`} />
                    </div>
                  </div>

                  {expandedPrId === pr.id && (
                    <div className="px-4 sm:px-6 py-6 bg-[#f8fafc] border-t border-slate-100 cursor-default shadow-inner">
                      <div className="max-w-4xl mx-auto space-y-8">
                        
                        <div className="relative overflow-hidden rounded-xl border border-indigo-100/60 bg-white shadow-sm hover:shadow-md transition-shadow duration-300">
                          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500"></div>
                          
                          <div className="p-5 sm:p-6 bg-gradient-to-br from-indigo-50/20 via-white to-purple-50/10">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-2.5">
                                <div className="p-1.5 bg-indigo-50 rounded-lg border border-indigo-100">
                                  <Bot className="w-5 h-5 text-indigo-500" />
                                </div>
                                <h4 className="text-sm font-semibold text-slate-800">AI 리뷰 요약</h4>
                              </div>
                              {summaries[pr.id]?.cached && (
                                <span className="text-[10px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <Check className="w-3 h-3" /> 캐시됨
                                </span>
                              )}
                            </div>
                            
                            {loadingSummaries[pr.id] ? (
                              <div className="flex items-center gap-3 py-4">
                                <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                                <span className="text-sm text-slate-500">AI가 PR 본문을 분석하고 있습니다...</span>
                              </div>
                            ) : summaries[pr.id] ? (
                              <div className="prose prose-sm max-w-none prose-slate prose-p:text-slate-600 prose-p:leading-relaxed prose-li:text-slate-700 prose-li:marker:text-indigo-400">
                                <ReactMarkdown>{summaries[pr.id].text}</ReactMarkdown>
                              </div>
                            ) : (
                              <div className="text-sm text-slate-500 italic py-2">
                                요약을 불러오는 중...
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <MessageSquare className="w-4 h-4 text-slate-500" />
                              <h4 className="text-sm font-semibold text-slate-700">
                                리뷰 코멘트 {commentsData[pr.id] ? `(${commentsData[pr.id].length})` : ''}
                              </h4>
                            </div>
                            
                            {/* 중요 코멘트 필터 토글 */}
                            {commentsData[pr.id] && commentsData[pr.id].length > 0 && (
                              <div className="flex items-center gap-2">
                                {loadingImportantComments[pr.id] ? (
                                  <span className="text-xs text-slate-500 flex items-center gap-1.5">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    AI 필터링 중...
                                  </span>
                                ) : importantComments[pr.id] && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowImportantOnly(prev => ({ ...prev, [pr.id]: !prev[pr.id] }));
                                    }}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                      showImportantOnly[pr.id]
                                        ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                        : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200'
                                    }`}
                                  >
                                    <Filter className="w-3 h-3" />
                                    {showImportantOnly[pr.id] 
                                      ? `중요 코멘트 (${importantComments[pr.id].comments.length})` 
                                      : '중요 코멘트만'}
                                    {importantComments[pr.id].cached && (
                                      <Check className="w-3 h-3 text-emerald-500 ml-1" />
                                    )}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {loadingComments[pr.id] ? (
                            <div className="flex items-center gap-3 py-8 justify-center text-slate-500">
                              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                              <span className="text-sm">리뷰 코멘트를 불러오는 중...</span>
                            </div>
                          ) : commentErrors[pr.id] ? (
                            <div className="py-8 text-center text-red-500 bg-red-50/50 rounded-lg border border-red-100">
                              <AlertCircle className="w-6 h-6 mx-auto mb-2" />
                              <p className="text-sm">{commentErrors[pr.id]}</p>
                            </div>
                          ) : getDisplayComments(pr.id).length > 0 ? (
                            <div className="space-y-3">
                              {getDisplayComments(pr.id).map((comment) => {
                                // 중요 코멘트인 경우 reason 표시
                                const importantInfo = showImportantOnly[pr.id] 
                                  ? importantComments[pr.id]?.comments.find(ic => ic.id === comment.id)
                                  : null;
                                
                                return (
                                  <div 
                                    key={comment.id} 
                                    className={`rounded-lg border bg-white overflow-hidden transition-shadow hover:shadow-sm ${
                                      comment.isReply ? 'ml-6 border-l-2 border-l-blue-200 border-slate-200' : 
                                      importantInfo ? 'border-amber-200 ring-1 ring-amber-100' : 'border-slate-200'
                                    }`}
                                  >
                                    <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 ${
                                      importantInfo ? 'bg-amber-50/70' : 'bg-slate-50/70'
                                    }`}>
                                      <img 
                                        src={comment.avatarUrl} 
                                        alt={comment.reviewer} 
                                        className="w-5 h-5 rounded-full border border-slate-200"
                                      />
                                      <span className="text-xs font-semibold text-slate-700">{comment.reviewer}</span>
                                      <span className="text-[10px] text-slate-400">
                                        {new Date(comment.created_at).toLocaleDateString('ko-KR')}
                                      </span>
                                      {comment.isReply && (
                                        <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">답글</span>
                                      )}
                                      {importantInfo && (
                                        <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium ml-auto flex items-center gap-1">
                                          <Sparkles className="w-3 h-3" />
                                          {importantInfo.reason}
                                        </span>
                                      )}
                                    </div>
                                    <div className="px-4 py-3 text-sm text-slate-700 prose prose-sm max-w-none prose-p:my-1 prose-code:text-xs prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-slate-800 prose-pre:text-slate-100">
                                      <ReactMarkdown>{comment.content}</ReactMarkdown>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="py-8 text-center text-slate-400 bg-slate-50/50 rounded-lg border border-slate-100">
                              <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">
                                {showImportantOnly[pr.id] ? '중요한 리뷰 코멘트가 없습니다.' : '아직 리뷰 코멘트가 없습니다.'}
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="pt-4 border-t border-slate-200 flex justify-end">
                          <a 
                            href={pr.githubUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
                          >
                            <Github className="w-4 h-4" />
                            GitHub에서 보기
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="py-16 text-center text-slate-400 bg-white">
                <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">검색 결과가 없습니다.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
