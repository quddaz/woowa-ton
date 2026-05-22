"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  GitPullRequest,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  Github,
  Info,
} from "lucide-react";

type ReviewBlock =
  | {
      type: "main";
      author: string;
      timeAgo: string;
      content: string;
    }
  | {
      type: "file";
      filePath: string;
      linesInfo: string;
      diffs: { line: number; code: string }[];
      comments: {
        id: number;
        author: string;
        isAuthor: boolean;
        timeAgo: string;
        content: string;
      }[];
    };

type PRItem = {
  id: number;
  title: string;
  author: string;
  authorName: string;
  status: "open" | "closed";
  createdAt: string;
  commentsCount: number;
  tasks: string;
  reviewStatus: string;
  aiSummary: string;
  blocks: ReviewBlock[];
};

const DUMMY_PRS: PRItem[] = [
  {
    id: 514,
    title:
      "[🚀 사이클2 - 미션 (예약 변경/취소와 에러 처리)] 와이제리(최용준) 미션 제출합니다.",
    author: "yj9107v",
    authorName: "와이제리",
    status: "open",
    createdAt: "4 days ago",
    commentsCount: 26,
    tasks: "4 of 5",
    reviewStatus: "Changes requested",
    aiSummary:
      "안녕하세요~ 로빈!\n\n아직 이론적인 지식이 부족하다 보니, 현재 작성한 코드에서 어떤 부분을 더 깊게 고민해보면 좋을지 스스로 질문을 잘 떠올리지 못하고 있습니다.\n\n그래서 이번 리뷰에서는 프로덕션 코드뿐만 아니라 단위 테스트와 인수 테스트까지 포함해, 리팩터링이 필요한 부분이나 설계적으로 더 고민해보면 좋을 부분을 중점적으로 피드백 부탁드리고 싶습니다.",
    blocks: [],
  },
];

const GITHUB_TOKEN = process.env.NEXT_PUBLIC_GITHUB_TOKEN;
const githubHeaders: Record<string, string> = {
  Accept: "application/vnd.github.v3+json",
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
};

export default function PRFinder() {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPrs, setExpandedPrs] = useState<Set<number>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(new Date());
  const [prs, setPrs] = useState<PRItem[]>(DUMMY_PRS);

  const fetchPRs = async () => {
    try {
      setIsSyncing(true);
      const res = await fetch(
        "https://api.github.com/repos/woowacourse/spring-roomescape-member/pulls?state=open&sort=updated&direction=desc&per_page=40",
        { headers: githubHeaders },
      );
      if (!res.ok) throw new Error("github api failed");
      const data = await res.json();
      const mapped: PRItem[] = (Array.isArray(data) ? data : []).map((pr: any) => ({
        id: pr.number,
        title: pr.title,
        author: pr.user?.login ?? "unknown",
        authorName: pr.user?.login ?? "unknown",
        status: "open",
        createdAt: new Date(pr.created_at).toLocaleDateString(),
        commentsCount: (pr.comments ?? 0) + (pr.review_comments ?? 0),
        tasks: "-",
        reviewStatus: pr.draft ? "Draft" : "Open",
        aiSummary: pr.body || "PR 본문 내용이 없습니다.",
        blocks: [],
      }));
      if (mapped.length > 0) setPrs(mapped);
      setLastSyncTime(new Date());
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchPRs();
    const syncInterval = setInterval(() => {
      fetchPRs();
    }, 60000);
    return () => clearInterval(syncInterval);
  }, []);

  const togglePrExpansion = (id: number) => {
    setExpandedPrs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredPrs = useMemo(() => {
    if (!searchQuery.trim()) return prs;
    const q = searchQuery.toLowerCase();
    return prs.filter(
      (pr) => pr.title.toLowerCase().includes(q) || pr.authorName.toLowerCase().includes(q),
    );
  }, [searchQuery, prs]);

  const timeAgoString = (date: Date) => {
    const diffMins = Math.round((Date.now() - date.getTime()) / 60000);
    if (diffMins === 0) return "방금 전";
    if (diffMins < 60) return `${diffMins}분 전`;
    return date.toLocaleTimeString();
  };

  const renderMarkdown = (text: string) =>
    text.split("\n").map((line, i) =>
      line.trim().startsWith(">") ? (
        <div key={i} className="pl-3.5 mb-3 border-l-[4px] border-[#d0d7de] text-[#656d76]">
          {line.substring(1).trim()}
        </div>
      ) : (
        <p key={i} className="mb-3 last:mb-0 min-h-[1em]">
          {line}
        </p>
      ),
    );

  return (
    <div className="min-h-screen bg-white text-[#1f2328] font-sans pb-12">
      <header className="bg-[#f6f8fa] border-b border-[#d0d7de] sticky top-0 z-20">
        <div className="max-w-[1280px] mx-auto px-4 h-[60px] flex items-center justify-between">
          <div className="flex items-center gap-3"><Github className="w-8 h-8 text-[#24292f]" /></div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-[#656d76]"><Clock className="w-3.5 h-3.5" /><span>Updated: {timeAgoString(lastSyncTime)}</span></div>
            <button onClick={fetchPRs} disabled={isSyncing} className={`flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#d0d7de] bg-[#f6f8fa] text-xs font-medium hover:bg-gray-100 ${isSyncing ? "opacity-70" : ""}`}>
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-[#0969da]" : "text-[#656d76]"}`} />
              {isSyncing ? "Syncing..." : "Sync"}
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-[1280px] mx-auto px-4 py-6">
        <div className="flex w-full sm:w-auto gap-2 flex-1 mb-4">
          <div className="relative w-full max-w-[600px]"><div className="absolute inset-y-0 left-0 pl-3 flex items-center"><Search className="h-4 w-4 text-[#656d76]" /></div><input type="text" placeholder="is:pr is:open" className="block w-full pl-9 pr-3 py-1.5 border border-[#d0d7de] rounded-md bg-[#f6f8fa]" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
        </div>
        <div className="border border-[#d0d7de] rounded-md overflow-hidden bg-white">
          <div className="bg-[#f6f8fa] border-b border-[#d0d7de] px-4 py-3 flex items-center justify-between text-sm font-semibold text-[#1f2328]"><div className="flex items-center gap-2"><GitPullRequest className="w-5 h-5 text-[#1a7f37]" /><span>{filteredPrs.length} Open</span><span className="font-normal text-[#656d76] ml-2 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Closed</span></div></div>
          <div className="divide-y divide-[#d0d7de]">
            {filteredPrs.map((pr) => {
              const isExpanded = expandedPrs.has(pr.id);
              return <div key={pr.id} className="flex flex-col group"><div className="px-4 py-3 hover:bg-[#f6f8fa] cursor-pointer flex items-start gap-3" onClick={() => togglePrExpansion(pr.id)}><GitPullRequest className="w-4 h-4 text-[#1a7f37] mt-1" /><div className="flex-1"><div className="flex items-center justify-between gap-2"><h3 className="text-[16px] font-semibold">{pr.title}</h3><div className="flex items-center gap-3"><div className="flex items-center gap-1.5 text-[#656d76]"><MessageSquare className="w-4 h-4" /><span className="text-xs font-semibold">{pr.commentsCount}</span></div>{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</div></div><div className="mt-1 text-xs text-[#656d76]">#{pr.id} opened {pr.createdAt} by {pr.author}</div></div></div>
              {isExpanded && <div className="bg-white border-t border-[#d0d7de] px-4 pt-10 pb-6"><div className="max-w-4xl mx-auto"><div className="relative mb-8 z-10 pl-[60px]"><div className="absolute -top-[28px] left-[60px] flex items-center gap-1 text-[#656d76]"><Info className="w-[14px] h-[14px]" /><span className="text-[12px] font-semibold tracking-wide">AI Summery</span></div><div className="border border-[#d0d7de] rounded-md bg-white"><div className="bg-[#f6f8fa] px-4 py-2.5 border-b border-[#d0d7de] rounded-t-md text-sm"><span className="font-semibold">{pr.author}</span></div><div className="p-4 text-[14px]">{renderMarkdown(pr.aiSummary)}</div></div></div></div></div>}
              </div>;
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
