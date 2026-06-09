import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  Flag,
  ListFilter,
  RotateCcw,
  Search,
  Shuffle,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import data from "./questionData.json";
import "./styles.css";

const typeLabels = {
  choice: "객관식",
  blank: "빈칸",
  ox: "O/X",
  essay: "서술형",
};

const initialFilters = {
  subject: "전체",
  year: "전체",
  session: "전체",
  type: "전체",
  query: "",
};

const ANSWER_STORAGE_KEY = "prok-study-answers-v2";
const LEGACY_ANSWER_STORAGE_KEY = "prok-study-answers";
const USER_ID_STORAGE_KEY = "prok-study-user-id";
const ADMIN_AUTH_STORAGE_KEY = "prok-study-admin-auth";

function questionAnswerKey(question) {
  const label = question.displayLabel || question.numberLabel || question.number || "";
  const title = (question.title || question.text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${question.documentId}::${label}::${title}`;
}

function getQuestionAnswer(answers, question) {
  if (!question) return {};
  return answers[questionAnswerKey(question)] || answers[question.id] || {};
}

function readLocalAnswers() {
  try {
    const current = JSON.parse(localStorage.getItem(ANSWER_STORAGE_KEY) || "{}");
    const legacy = JSON.parse(localStorage.getItem(LEGACY_ANSWER_STORAGE_KEY) || "{}");
    return { ...legacy, ...current };
  } catch {
    return {};
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "server request failed");
  }
  return body;
}

function useStoredAnswers() {
  const [userId, setUserId] = useState(() => localStorage.getItem(USER_ID_STORAGE_KEY) || "");
  const [answers, setAnswers] = useState({});
  const [status, setStatus] = useState(userId ? "loading" : "signed-out");
  const [error, setError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    if (!userId) return undefined;

    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      setError("");

      try {
        const serverState = await requestJson(`/api/progress/${encodeURIComponent(userId)}`);
        const localAnswers = readLocalAnswers();
        const hasLocalAnswers = Object.keys(localAnswers).length > 0;
        const mergedAnswers = { ...localAnswers, ...(serverState.answers || {}) };

        if (hasLocalAnswers) {
          await requestJson(`/api/progress/${encodeURIComponent(userId)}`, {
            method: "PUT",
            body: JSON.stringify({ answers: mergedAnswers }),
          });
          localStorage.removeItem(ANSWER_STORAGE_KEY);
          localStorage.removeItem(LEGACY_ANSWER_STORAGE_KEY);
        }

        if (!cancelled) {
          setAnswers(mergedAnswers);
          setStatus("ready");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError("저장 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
          setStatus("error");
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [userId, loadVersion]);

  const login = (rawUserId) => {
    const nextUserId = rawUserId.trim();
    if (!nextUserId || nextUserId.length > 64 || /[\u0000-\u001f/\\]/u.test(nextUserId)) {
      setError("학습 ID는 1-64자이고 / 또는 \\ 문자는 사용할 수 없습니다.");
      setStatus("signed-out");
      return;
    }

    localStorage.setItem(USER_ID_STORAGE_KEY, nextUserId);
    setStatus("loading");
    setUserId(nextUserId);
    setLoadVersion((version) => version + 1);
  };

  const logout = () => {
    localStorage.removeItem(USER_ID_STORAGE_KEY);
    setUserId("");
    setAnswers({});
    setError("");
    setStatus("signed-out");
  };

  const updateAnswer = (question, patch) => {
    setAnswers((current) => {
      const stableKey = questionAnswerKey(question);
      const existing = current[stableKey] || current[question.id] || {};
      const nextAnswer = { ...existing, ...patch };
      const next = { ...current, [stableKey]: nextAnswer };
      requestJson(`/api/progress/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify({ key: stableKey, answer: nextAnswer }),
      }).catch(() => setError("진행상황 저장에 실패했습니다."));
      return next;
    });
  };

  const reset = () => {
    setAnswers({});
    requestJson(`/api/progress/${encodeURIComponent(userId)}`, { method: "DELETE" }).catch(() =>
      setError("진행상황 초기화에 실패했습니다."),
    );
  };

  return { answers, updateAnswer, resetAnswers: reset, userId, login, logout, answerStatus: status, answerError: error };
}

function normalizeQuestionText(question) {
  const base = question.body || question.text || "";
  if (!question.options?.length) return base;
  const marker = base.indexOf(question.options[0]);
  if (marker < 0) return base;
  return base.slice(0, marker).trim();
}

const emptyBlankPattern = /\(\s*\)/g;
const numberedBlankPattern = /\(\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*\)/g;
const labeledBlankPattern = /\(\s*[A-Za-z가-힣]\s*\)/g;

function numberBlankPlaceholders(text = "") {
  let index = 0;
  return text.replace(emptyBlankPattern, () => {
    index += 1;
    return `( ${index} )`;
  });
}

function getBlankAnswerSource(question) {
  const body = question.body || question.text || "";
  if (body && body !== question.title) return body;
  return question.title || body || "";
}

function getBlankAnswerCount(question) {
  const text = getBlankAnswerSource(question);
  const emptyCount = [...text.matchAll(emptyBlankPattern)].length;
  const numberedCount = [...text.matchAll(numberedBlankPattern)].length;
  const labeledCount = [...text.matchAll(labeledBlankPattern)].length;
  return emptyCount + numberedCount + labeledCount;
}

function getQuestionTitle(question) {
  if (question.type !== "blank") return question.title;
  if (getBlankAnswerSource(question) !== question.title) return question.title;
  return numberBlankPlaceholders(question.title);
}

function getQuestionPrompt(question) {
  const prompt = normalizeQuestionText(question);
  if (question.type !== "blank") return prompt;
  return numberBlankPlaceholders(prompt);
}

function documentDisplayName(fileName) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceUrl(document) {
  return document ? encodeURI(`/${document.filePath}`) : "#";
}

function fileExtension(fileName = "") {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

function sourcePreviewUrl(document) {
  if (!document) return "#";
  return fileExtension(document.fileName) === "hwp"
    ? encodeURI(`/hwp-html/${document.id}.html`)
    : sourceUrl(document);
}

function App() {
  if (window.location.pathname === "/admin") {
    return <AdminApp />;
  }

  const [filters, setFilters] = useState(initialFilters);
  const [activeId, setActiveId] = useState(null);
  const [collectionView, setCollectionView] = useState(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [sourceDocument, setSourceDocument] = useState(null);
  const [practiceSeed, setPracticeSeed] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(true);
  const [answerSnapshot, setAnswerSnapshot] = useState(null);
  const practicePanelRef = useRef(null);
  const {
    answers,
    updateAnswer,
    resetAnswers,
    userId,
    login,
    logout,
    answerStatus,
    answerError,
  } = useStoredAnswers();
  const answersRef = useRef(answers);
  answersRef.current = answers;

  useEffect(() => {
    if (answerStatus === "ready") {
      setAnswerSnapshot(answersRef.current);
    }
  }, [answerStatus, userId]);

  const years = useMemo(
    () => [...new Set(data.questions.map((q) => q.year).filter(Boolean))].sort((a, b) => b - a),
    [],
  );

  const documentsById = useMemo(
    () => Object.fromEntries(data.documents.map((doc) => [doc.id, doc])),
    [],
  );

  const selectedDocument = selectedDocumentId ? documentsById[selectedDocumentId] : null;

  const documentRows = useMemo(() => {
    const query = filters.query.trim().toLowerCase();

    return data.documents.filter((doc) => {
      if (filters.subject !== "전체" && doc.subject !== filters.subject) return false;
      if (filters.year !== "전체" && String(doc.year) !== String(filters.year)) return false;
      if (filters.session !== "전체" && doc.session !== filters.session) return false;
      if (filters.type === "전체" && !query) return true;

      return data.questions.some((q) => {
        if (q.documentId !== doc.id) return false;
        if (filters.type !== "전체" && q.type !== filters.type) return false;
        if (!query) return true;
        return `${q.groupTitle || ""} ${q.title} ${q.body} ${q.text} ${q.sourceTitle} ${q.fileName} ${(q.displayLabel || q.numberLabel || q.number || "")}`
          .toLowerCase()
          .includes(query);
      });
    });
  }, [filters]);

  const filteredQuestions = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return data.questions.filter((q) => {
      if (selectedDocumentId && q.documentId !== selectedDocumentId) return false;
      if (filters.subject !== "전체" && q.subject !== filters.subject) return false;
      if (filters.year !== "전체" && String(q.year) !== String(filters.year)) return false;
      if (filters.session !== "전체" && q.session !== filters.session) return false;
      if (filters.type !== "전체" && q.type !== filters.type) return false;
      if (!query) return true;
      return `${q.groupTitle || ""} ${q.title} ${q.body} ${q.text} ${q.sourceTitle} ${q.fileName} ${(q.displayLabel || q.numberLabel || q.number || "")}`.toLowerCase().includes(query);
    });
  }, [filters, selectedDocumentId]);

  const practiceCandidates = useMemo(() => {
    if (!incompleteOnly) return filteredQuestions;
    return filteredQuestions.filter((q) => !getQuestionAnswer(answerSnapshot || answers, q).done);
  }, [answerSnapshot, answers, filteredQuestions, incompleteOnly]);

  const makeSeededRandom = (seed) => {
    let state = seed;
    return () => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
  };

  const shuffleWithSeed = (items, seed) => {
    const copy = [...items];
    const random = makeSeededRandom(seed);
    for (let index = copy.length - 1; index > 0; index--) {
      const j = Math.floor(random() * (index + 1));
      [copy[index], copy[j]] = [copy[j], copy[index]];
    }
    return copy;
  };

  const takeRandom = (items, count, seed) => {
    if (!items.length || count <= 0) return [];
    return shuffleWithSeed(items, seed).slice(0, Math.min(count, items.length));
  };

  const practiceQuestions = useMemo(() => {
    if (selectedDocumentId) {
      return practiceCandidates;
    }

    const constitutionQuestions = practiceCandidates.filter((q) => q.subject === "교단헌법");
    const bibleQuestions = practiceCandidates.filter((q) => q.subject === "성경");
    const target = {
      교단헌법: 20,
      성경: 10,
    };

    let seed = practiceSeed || 11;
    const constitutionPool = takeRandom(constitutionQuestions, target["교단헌법"], seed);
    seed = (seed * 9301 + 49297) % 233280;
    const biblePool = takeRandom(bibleQuestions, target["성경"], seed);
    const picked = [...constitutionPool, ...biblePool];

    if (picked.length >= 30) {
      return picked.slice(0, 30);
    }

    const selectedIds = new Set(picked.map((q) => q.id));
    const leftovers = practiceCandidates.filter((q) => !selectedIds.has(q.id));
    const extra = takeRandom(leftovers, 30 - picked.length, (seed * 9301 + 49297) % 233280);
    return [...picked, ...extra];
  }, [practiceCandidates, practiceSeed, selectedDocumentId]);

  const activeQuestion = useMemo(() => {
    return practiceQuestions.find((q) => q.id === activeId) || practiceQuestions[0];
  }, [activeId, practiceQuestions]);

  const stats = useMemo(() => {
    const completed = data.questions.filter((q) => getQuestionAnswer(answers, q).done).length;
    const flagged = data.questions.filter((q) => getQuestionAnswer(answers, q).flagged).length;
    return {
      documents: data.documents.length,
      questions: data.questions.length,
      completed,
      flagged,
    };
  }, [answers]);

  const collectionRows = useMemo(() => {
    if (collectionView === "documents") return documentRows;
    if (collectionView === "completed") {
      return filteredQuestions.filter((q) => getQuestionAnswer(answers, q).done);
    }
    if (collectionView === "flagged") {
      return filteredQuestions.filter((q) => getQuestionAnswer(answers, q).flagged);
    }
    return filteredQuestions;
  }, [answers, collectionView, documentRows, filteredQuestions]);

  const openCollectionView = (view) => {
    setCollectionView(view);
    setSelectedDocumentId(null);
    setActiveId(null);
    requestAnimationFrame(() => {
      practicePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const closeCollectionView = () => {
    setCollectionView(null);
  };

  const updateFilter = (key, value) => {
    setAnswerSnapshot(answers);
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedDocumentId(null);
    setActiveId(null);
  };

  const refreshPracticeSet = () => {
    setAnswerSnapshot(answers);
    setCollectionView(null);
    setSelectedDocumentId(null);
    setActiveId(null);
    setPracticeSeed((n) => n + 1);
  };

  const openDocumentQuestions = (doc) => {
    setAnswerSnapshot(answers);
    setCollectionView(null);
    setSelectedDocumentId(doc.id);
    setFilters((current) => ({
      ...current,
      type: "전체",
      query: "",
    }));
    setActiveId(null);
  };

  const openQuestionFromList = (question) => {
    setAnswerSnapshot(answers);
    setCollectionView(null);
    setIncompleteOnly(false);
    setSelectedDocumentId(question.documentId);
    setActiveId(question.id);
  };

  const resetPracticeAnswers = () => {
    resetAnswers();
    setAnswerSnapshot({});
    setActiveId(null);
  };

  const activeQuestionIndex = activeQuestion ? practiceQuestions.findIndex((q) => q.id === activeQuestion.id) : -1;

  const goToNextQuestion = () => {
    if (!activeQuestion) return;
    const nextQuestion = practiceQuestions[activeQuestionIndex + 1];
    if (nextQuestion) {
      setActiveId(nextQuestion.id);
    }
  };

  if (answerStatus !== "ready") {
    return (
      <LoginScreen
        error={answerError}
        initialUserId={userId}
        loading={answerStatus === "loading"}
        onLogin={login}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={22} />
          </span>
          <div>
            <h1>목사고시 기출문제</h1>
            <p>2010-2026년 공개 기출문제를 연도와 과목별로 풀어보는 로컬 학습 사이트</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="user-badge">
            <span>{userId}</span>
            <button type="button" onClick={logout}>ID 변경</button>
          </div>
          <button className="ghost-button" onClick={refreshPracticeSet}>
            <Shuffle size={17} /> 새 문제 세트
          </button>
        </div>
      </header>
      {answerError && <div className="sync-alert">{answerError}</div>}

      <section className="overview">
        <div className="summary">
          <div className="summary-copy">
            <h2>원문 기반 문제 풀이</h2>
            <p>
              첨부 문서 64개에서 추출한 {stats.questions.toLocaleString()}개 문제를 객관식, 빈칸,
              O/X, 서술형으로 분류했습니다. 답안은 서버에 자동 저장됩니다.
            </p>
          </div>
          <div className="metric-grid">
            <Metric
              active={collectionView === "documents"}
              icon={<FileText size={18} />}
              label="문서"
              onClick={() => openCollectionView("documents")}
              value={stats.documents}
            />
            <Metric
              active={collectionView === "questions"}
              icon={<ListFilter size={18} />}
              label="문제"
              onClick={() => openCollectionView("questions")}
              value={stats.questions.toLocaleString()}
            />
            <Metric
              active={collectionView === "completed"}
              icon={<CheckCircle2 size={18} />}
              label="완료"
              onClick={() => openCollectionView("completed")}
              value={stats.completed}
            />
            <Metric
              active={collectionView === "flagged"}
              icon={<Flag size={18} />}
              label="복습"
              onClick={() => openCollectionView("flagged")}
              value={stats.flagged}
            />
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className={`sidebar ${mobileFiltersOpen ? "open" : ""}`}>
          <button
            aria-expanded={mobileFiltersOpen}
            className="filter-toggle"
            type="button"
            onClick={() => setMobileFiltersOpen((current) => !current)}
          >
            <span>
              <ListFilter size={17} />
              문제 필터
            </span>
            <ChevronDown size={18} />
          </button>

          <div className="filter-card">
            <div className="filter-title">
              <Search size={17} />
              <span>문제 찾기</span>
            </div>
            <input
              className="search-input"
              value={filters.query}
              onChange={(e) => updateFilter("query", e.target.value)}
              placeholder="본문, 파일명, 연도 검색"
            />
            <Select
              label="과목"
              value={filters.subject}
              onChange={(v) => updateFilter("subject", v)}
              options={["전체", "성경", "교단헌법"].map((label) => ({ label, value: label }))}
            />
            <Select
              label="연도"
              value={filters.year}
              onChange={(v) => updateFilter("year", v)}
              options={[
                { label: "전체", value: "전체" },
                ...years.map((year) => ({ label: String(year), value: String(year) })),
              ]}
            />
            <Select
              label="회차"
              value={filters.session}
              onChange={(v) => updateFilter("session", v)}
              options={["전체", "제1차", "제2차", "기타"].map((label) => ({ label, value: label }))}
            />
            <Select
              label="유형"
              value={filters.type}
              onChange={(v) => updateFilter("type", v)}
              options={[
                { label: "전체", value: "전체" },
                ...Object.entries(typeLabels).map(([value, label]) => ({ label, value })),
              ]}
            />
          </div>

          <div className="source-list">
            <h3>문서 목록 ({documentRows.length})</h3>
            {documentRows.map((doc) => (
              <button
                className={`source-row ${selectedDocumentId === doc.id ? "active" : ""}`}
                key={doc.id}
                type="button"
                onClick={() => openDocumentQuestions(doc)}
              >
                <span>{doc.year || "미상"}</span>
                <p title={doc.fileName}>
                  <b>{doc.session} · {doc.subject}</b>
                  <small>{documentDisplayName(doc.fileName)}</small>
                </p>
                <strong>{doc.questionCount}</strong>
              </button>
            ))}
          </div>
        </aside>

        <section className="practice-panel" ref={practicePanelRef}>
          {collectionView ? (
            <CollectionView
              answers={answers}
              documentsById={documentsById}
              onClose={closeCollectionView}
              onOpenDocument={openDocumentQuestions}
              onOpenQuestion={openQuestionFromList}
              rows={collectionRows}
              type={collectionView}
            />
          ) : (
            <>
              <div className="panel-header">
                <div>
                  <span className="eyeless-label">{selectedDocumentId ? "선택 문서" : "현재 세트"}</span>
                  <h2>
                    {selectedDocument
                      ? `${selectedDocument.year || "미상"} ${selectedDocument.session} ${selectedDocument.subject} ${practiceQuestions.length}개`
                      : `${practiceCandidates.length.toLocaleString()}개 중 ${practiceQuestions.length}개 풀이`}
                  </h2>
                </div>
                <div className="panel-controls">
                  <button
                    aria-pressed={incompleteOnly}
                    className={`toggle-button ${incompleteOnly ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setAnswerSnapshot(answers);
                      setIncompleteOnly((current) => !current);
                      setActiveId(null);
                    }}
                  >
                    미완료만 보기
                  </button>
                  <button className="ghost-button small" onClick={resetPracticeAnswers}>
                    <RotateCcw size={16} /> 기록 초기화
                  </button>
                </div>
              </div>

              <div className="question-layout">
                <nav className="question-rail" aria-label="문제 선택">
                  {practiceQuestions.map((q, index) => {
                    const answer = getQuestionAnswer(answers, q);
                    return (
                    <button
                      key={q.id}
                      className={`rail-item ${activeQuestion?.id === q.id ? "active" : ""} ${
                        answer.done ? "done" : ""
                      }`}
                      onClick={() => setActiveId(q.id)}
                    >
                      <span>{selectedDocumentId ? q.displayLabel || q.numberLabel || index + 1 : index + 1}</span>
                      <small>{q.subject}</small>
                    </button>
                    );
                  })}
                </nav>

                {activeQuestion ? (
                  <QuestionCard
                    question={activeQuestion}
                    answer={getQuestionAnswer(answers, activeQuestion)}
                    updateAnswer={(patch) => updateAnswer(activeQuestion, patch)}
                    document={documentsById[activeQuestion.documentId]}
                    openSource={setSourceDocument}
                    onNext={goToNextQuestion}
                    hasNext={activeQuestionIndex >= 0 && activeQuestionIndex < practiceQuestions.length - 1}
                    userId={userId}
                  />
                ) : (
                  <div className="empty-state">
                    {incompleteOnly ? "조건에 맞는 미완료 문제가 없습니다." : "조건에 맞는 문제가 없습니다."}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </section>

      <SourceModal document={sourceDocument} onClose={() => setSourceDocument(null)} />
    </main>
  );
}

function Metric({ active, label, value, icon, onClick }) {
  return (
    <button
      aria-pressed={active}
      className={`metric ${active ? "active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span>{icon}</span>
      <strong>{value}</strong>
      <p>{label}</p>
    </button>
  );
}

const collectionLabels = {
  documents: "문서",
  questions: "문제",
  completed: "완료",
  flagged: "복습",
};

function CollectionView({ answers, documentsById, onClose, onOpenDocument, onOpenQuestion, rows, type }) {
  const label = collectionLabels[type] || "목록";
  const isDocumentList = type === "documents";

  return (
    <div className="collection-panel">
      <div className="panel-header collection-header">
        <div>
          <span className="eyeless-label">목록</span>
          <h2>{label} {rows.length.toLocaleString()}개</h2>
          <p>왼쪽 문제 찾기 필터와 검색어가 적용된 결과입니다.</p>
        </div>
        <button className="ghost-button small" type="button" onClick={onClose}>
          문제 풀이로 돌아가기
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state compact">조건에 맞는 {label} 내역이 없습니다.</div>
      ) : (
        <div className="collection-list">
          {isDocumentList
            ? rows.map((doc) => (
                <button
                  className="collection-row document-result"
                  key={doc.id}
                  type="button"
                  onClick={() => onOpenDocument(doc)}
                >
                  <span className="collection-meta">
                    {doc.year || "미상"} · {doc.session} · {doc.subject}
                  </span>
                  <strong>{documentDisplayName(doc.fileName)}</strong>
                  <small>{doc.questionCount}문항</small>
                </button>
              ))
            : rows.map((question) => {
                const answer = getQuestionAnswer(answers, question);
                const document = documentsById[question.documentId];
                return (
                  <button
                    className="collection-row question-result"
                    key={question.id}
                    type="button"
                    onClick={() => onOpenQuestion(question)}
                  >
                    <span className="collection-meta">
                      {question.year || "미상"} · {question.session} · {question.subject} · {typeLabels[question.type]} ·
                      문제 {question.displayLabel || question.numberLabel || question.number}
                    </span>
                    <strong>{question.title || normalizeQuestionText(question)}</strong>
                    <small>
                      {document ? documentDisplayName(document.fileName) : question.fileName}
                      {answer.done && <b>완료</b>}
                      {answer.flagged && <b>복습</b>}
                    </small>
                  </button>
                );
              })}
        </div>
      )}
    </div>
  );
}

function LoginScreen({ error, initialUserId, loading, onLogin }) {
  const [value, setValue] = useState(initialUserId);

  useEffect(() => {
    setValue(initialUserId);
  }, [initialUserId]);

  const submit = (event) => {
    event.preventDefault();
    onLogin(value);
  };

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <span className="brand-mark">
          <BookOpen size={22} />
        </span>
        <h1>목사고시 기출문제</h1>
        <p>학습 ID를 입력하면 완료, 복습, 풀이 메모가 서버에 저장됩니다.</p>
        <label className="login-field">
          <span>학습 ID</span>
          <input
            autoFocus
            disabled={loading}
            maxLength={64}
            onChange={(event) => setValue(event.target.value)}
            placeholder="예: my-study"
            value={value}
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button className="primary-button login-button" disabled={loading} type="submit">
          {loading ? "불러오는 중" : "시작하기"}
        </button>
        <small>비밀번호 없는 개인 학습용 ID입니다. 같은 ID를 입력하면 같은 기록을 불러옵니다.</small>
      </form>
    </main>
  );
}

function Select({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value)) || options[0];
  const listboxId = `${label}-select-listbox`;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className={`select-field ${open ? "open" : ""}`} ref={ref}>
      <span>{label}</span>
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        className="select-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected.label}</span>
      </button>
      {open && (
        <div className="select-menu" id={listboxId} role="listbox">
          {options.map((option) => (
            <button
              aria-selected={String(option.value) === String(value)}
              className="select-option"
              key={option.value}
              role="option"
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionCard({ question, answer, updateAnswer, document, openSource, onNext, hasNext, userId }) {
  const [answerSummary, setAnswerSummary] = useState(null);
  const [objectionOpen, setObjectionOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryStatus, setSummaryStatus] = useState("idle");
  const [summaryError, setSummaryError] = useState("");
  const prompt = getQuestionPrompt(question);
  const questionTitle = getQuestionTitle(question);
  const groupPrompt = question.groupTitle && question.groupTitle !== question.title ? question.groupTitle : "";
  const answerKey = questionAnswerKey(question);
  const blankAnswerCount = getBlankAnswerCount(question);
  const canShowSummary = ["choice", "ox", "blank", "essay"].includes(question.type);

  const loadAnswerSummary = async () => {
    setSummaryStatus("loading");
    setSummaryError("");
    try {
      const summary = await requestJson("/api/answers/summary", {
        method: "POST",
        body: JSON.stringify({
          answerKey,
          userId,
          questionType: question.type,
          options: question.options || [],
          limit: 10,
        }),
      });
      setAnswerSummary(summary);
      setSummaryStatus("ready");
    } catch {
      setSummaryError("다른 사용자 답변을 불러오지 못했습니다.");
      setSummaryStatus("error");
    }
  };

  const toggleAnswerSummary = () => {
    const nextOpen = !summaryOpen;
    setSummaryOpen(nextOpen);
    if (nextOpen) {
      loadAnswerSummary();
    }
  };

  const voteOnAnswer = async (answerUserId, vote) => {
    const currentVote = answerSummary?.answers?.find((item) => item.userId === answerUserId)?.myVote || 0;
    const nextVote = currentVote === vote ? 0 : vote;
    try {
      await requestJson("/api/answers/vote", {
        method: "POST",
        body: JSON.stringify({ answerKey, answerUserId, userId, vote: nextVote }),
      });
      await loadAnswerSummary();
    } catch {
      setSummaryError("투표를 저장하지 못했습니다.");
      setSummaryStatus("error");
    }
  };

  useEffect(() => {
    setAnswerSummary(null);
    setSummaryOpen(false);
    setSummaryStatus("idle");
    setSummaryError("");
    setObjectionOpen(false);
  }, [question.id]);

  return (
    <article className="question-card">
      <div className="question-meta">
        <span>{question.year}</span>
        <span>{question.session}</span>
        <span>{question.subject}</span>
        <span>{typeLabels[question.type]}</span>
        <span>문제 {question.displayLabel || question.numberLabel || question.number}</span>
      </div>

      {groupPrompt && <div className="group-prompt">{groupPrompt}</div>}

      {questionTitle && (
        <h3 className="question-title">{questionTitle}</h3>
      )}
      {prompt && question.body && question.body !== question.title && <p className="question-body">{prompt}</p>}

      {question.options?.length > 0 && (
        <div className="option-list">
          {question.options.map((option) => (
            <button
              key={option}
              className={answer.choice === option ? "selected" : ""}
              onClick={() => updateAnswer({ choice: option })}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {question.type === "ox" && (
        <div className="ox-row">
          {["O", "X"].map((value) => (
            <button
              key={value}
              className={answer.choice === value ? "selected" : ""}
              onClick={() => updateAnswer({ choice: value })}
            >
              {value}
            </button>
          ))}
        </div>
      )}

      {question.type === "blank" && blankAnswerCount > 0 ? (
        <BlankAnswerInputs answer={answer} count={blankAnswerCount} updateAnswer={updateAnswer} />
      ) : (
        <label className="answer-box">
          <span>{question.type === "essay" ? "서술 답안" : "내 풀이 메모"}</span>
          <textarea
            value={answer.note || ""}
            onChange={(e) => updateAnswer({ note: e.target.value })}
            placeholder="여기에 답안을 작성하세요. 정답지는 원문에 없어서 자기 채점용으로 저장됩니다."
          />
        </label>
      )}

      {canShowSummary && (
        <div className="other-answer-section">
          <button className="ghost-button small" type="button" onClick={toggleAnswerSummary}>
            {summaryOpen ? "다른 사용자 답변 닫기" : "다른 사용자 답변 보기"}
          </button>
          {summaryOpen && (
            <AnswerSummaryPanel
              onVote={voteOnAnswer}
              questionType={question.type}
              status={summaryStatus}
              summary={answerSummary}
              error={summaryError}
            />
          )}
        </div>
      )}

      <div className="question-actions">
        <div className="action-row primary-row">
          <button className={answer.done ? "primary-button done" : "primary-button"} onClick={() => updateAnswer({ done: !answer.done })}>
            <CheckCircle2 size={17} /> 완료 표시
          </button>
          <button className="ghost-button next-button" type="button" onClick={onNext} disabled={!hasNext}>
            다음 <ArrowRight size={17} />
          </button>
        </div>
        <div className="action-row secondary-row">
          <button className={answer.flagged ? "flag-button active" : "flag-button"} onClick={() => updateAnswer({ flagged: !answer.flagged })}>
            <Flag size={17} /> 복습
          </button>
          <button className="source-link" type="button" onClick={() => document && openSource(document)}>
            <FileText size={17} /> 원본
          </button>
          <button className="ghost-button" type="button" onClick={() => setObjectionOpen(true)}>
            <Flag size={17} /> 이의제기
          </button>
        </div>
      </div>

      <ObjectionModal
        answerKey={answerKey}
        document={document}
        onClose={() => setObjectionOpen(false)}
        open={objectionOpen}
        question={question}
        userId={userId}
      />

      <footer className="question-source">
        <Clock3 size={15} />
        <span>{question.sourceTitle}</span>
        <span>{question.fileName}</span>
      </footer>
    </article>
  );
}

function QuestionReadOnlyDetails({ document, question }) {
  return (
    <div className="readonly-details">
      <label>
        <span>연도</span>
        <input readOnly value={question.year || "미상"} />
      </label>
      <label>
        <span>회차</span>
        <input readOnly value={question.session || "미상"} />
      </label>
      <label>
        <span>과목</span>
        <input readOnly value={question.subject || "미상"} />
      </label>
      <label>
        <span>유형</span>
        <input readOnly value={typeLabels[question.type] || question.type || "미상"} />
      </label>
      <label>
        <span>문제 번호</span>
        <input readOnly value={question.displayLabel || question.numberLabel || question.number || "미상"} />
      </label>
      <label className="wide">
        <span>원문</span>
        <input readOnly value={document ? documentDisplayName(document.fileName) : question.fileName || "미상"} />
      </label>
    </div>
  );
}

function ObjectionModal({ answerKey, document, onClose, open, question, userId }) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setMessage("");
      setStatus("idle");
      setError("");
    }
  }, [open, question.id]);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError("이의제기 내용을 입력하세요.");
      return;
    }

    setStatus("loading");
    setError("");
    try {
      await requestJson("/api/objections", {
        method: "POST",
        body: JSON.stringify({
          userId,
          answerKey,
          questionId: question.id,
          question: {
            id: question.id,
            year: question.year,
            session: question.session,
            subject: question.subject,
            type: question.type,
            typeLabel: typeLabels[question.type] || question.type,
            number: question.displayLabel || question.numberLabel || question.number,
            title: getQuestionTitle(question),
            body: getQuestionPrompt(question),
            fileName: question.fileName,
            sourceTitle: question.sourceTitle,
          },
          message: trimmed,
        }),
      });
      setStatus("done");
      setMessage("");
    } catch {
      setStatus("idle");
      setError("이의제기를 저장하지 못했습니다. 잠시 후 다시 시도하세요.");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="objection-modal" role="dialog" aria-modal="true" aria-labelledby="objection-modal-title">
        <header className="source-modal-header">
          <div>
            <span className="eyeless-label">문제 이의제기</span>
            <h2 id="objection-modal-title">선택한 문제 정보 확인</h2>
            <p>상단 정보는 수정할 수 없으며, 하단에 이의제기 내용을 작성합니다.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="이의제기 닫기">
            <X size={20} />
          </button>
        </header>

        <form className="objection-form" onSubmit={submit}>
          <QuestionReadOnlyDetails document={document} question={question} />
          <label className="answer-box objection-textarea">
            <span>이의제기 내용</span>
            <textarea
              autoFocus
              maxLength={4000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="문제 오류, 분류 오류, 원문 대조가 필요한 부분 등을 구체적으로 적어주세요."
              readOnly={status === "done"}
              value={message}
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          {status === "done" && <p className="success-alert">이의제기가 접수되었습니다.</p>}
          <div className="modal-action-row">
            <button className="ghost-button" type="button" onClick={onClose}>닫기</button>
            <button className="primary-button" disabled={status === "loading" || status === "done"} type="submit">
              {status === "loading" ? "접수 중" : "이의제기 접수"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function BlankAnswerInputs({ answer, count, updateAnswer }) {
  const values = Array.from({ length: count }, (_, index) => answer.blankAnswers?.[index] || "");

  const updateValue = (index, value) => {
    const next = [...values];
    next[index] = value;
    updateAnswer({ blankAnswers: next });
  };

  return (
    <div className="answer-box blank-answer-box">
      <span>정답 입력</span>
      <div className="blank-answer-list">
        {values.map((value, index) => (
          <label className="blank-answer-row" key={index}>
            <span>{index + 1}.</span>
            <input
              type="text"
              value={value}
              onChange={(event) => updateValue(index, event.target.value)}
              placeholder={`${index + 1}번 빈칸 답`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function AnswerSummaryPanel({ error, onVote, questionType, status, summary }) {
  if (status === "loading") {
    return <div className="answer-summary-panel">불러오는 중입니다.</div>;
  }

  if (status === "error") {
    return <div className="answer-summary-panel error">{error}</div>;
  }

  if (!summary) return null;

  if (summary.mode === "aggregate") {
    return (
      <div className="answer-summary-panel">
        <div className="summary-panel-header">
          <strong>다른 사용자 답변</strong>
          <span>{summary.total}명 응답</span>
        </div>
        <div className="aggregate-list">
          {summary.choices.map((choice) => (
            <div className="aggregate-row" key={choice.value}>
              <span>{choice.value}</span>
              <div className="aggregate-meter">
                <i style={{ width: `${choice.percentage}%` }} />
              </div>
              <b>{choice.percentage}%</b>
              <em>{choice.count}명</em>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="answer-summary-panel">
      <div className="summary-panel-header">
        <strong>다른 사용자 답변</strong>
        <span>{summary.total}개 중 상위 {summary.answers.length}개</span>
      </div>
      {summary.answers.length === 0 ? (
        <p className="summary-empty">아직 다른 사용자의 답변이 없습니다.</p>
      ) : (
        <div className="written-answer-list">
          {summary.answers.map((item) => (
            <article className="written-answer-row" key={item.userId}>
              <div>
                <b>{item.userId}</b>
                {questionType === "blank" ? (
                  <ol>
                    {(item.payload.blankAnswers || []).map((value, index) => (
                      <li key={index}>{value || "-"}</li>
                    ))}
                  </ol>
                ) : (
                  <p>{item.payload.note}</p>
                )}
              </div>
              <div className="vote-box">
                <button
                  className={item.myVote === 1 ? "active" : ""}
                  type="button"
                  onClick={() => onVote(item.userId, 1)}
                  aria-label={`${item.userId} 답변 추천`}
                >
                  <ThumbsUp size={15} />
                </button>
                <strong>{item.voteScore}</strong>
                <button
                  className={item.myVote === -1 ? "active" : ""}
                  type="button"
                  onClick={() => onVote(item.userId, -1)}
                  aria-label={`${item.userId} 답변 비추천`}
                >
                  <ThumbsDown size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function PdfCanvasViewer({ fallbackText, url }) {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const [activePage, setActivePage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [viewerWidth, setViewerWidth] = useState(0);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;

    const updateWidth = () => setViewerWidth(viewer.clientWidth || 0);
    updateWidth();

    if (typeof window === "undefined") return undefined;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask;

    setActivePage(1);
    setError("");
    setLoading(true);
    setPageCount(0);
    setPdfDoc(null);

    if (!url) {
      setLoading(false);
      return undefined;
    }

    const loadPdf = async () => {
      try {
        const [{ default: pdfWorkerUrl }, pdfjsLib] = await Promise.all([
          import("pdfjs-dist/build/pdf.worker.mjs?url"),
          import("pdfjs-dist"),
        ]);
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjsLib.getDocument({ url });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setPdfDoc(pdf);
        setPageCount(pdf.numPages);
      } catch {
        if (!cancelled) {
          setError("PDF를 불러오지 못했습니다. 아래 추출 텍스트를 확인하거나 원본 파일을 열어주세요.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdfDoc || !viewerWidth) return undefined;

    let cancelled = false;
    let renderTask;
    setLoading(true);

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(activePage);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min((viewerWidth - 24) / baseViewport.width, 2);
        const cssViewport = page.getViewport({ scale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = page.getViewport({ scale: scale * outputScale });
        const context = canvas.getContext("2d");

        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;

        renderTask = page.render({ canvasContext: context, viewport: renderViewport });
        await renderTask.promise;
      } catch (renderError) {
        if (!cancelled && renderError?.name !== "RenderingCancelledException") {
          setError("PDF 페이지를 렌더링하지 못했습니다. 아래 추출 텍스트를 확인하거나 원본 파일을 열어주세요.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [activePage, pdfDoc, viewerWidth]);

  const canGoPrevious = activePage > 1;
  const canGoNext = pageCount > 0 && activePage < pageCount;

  return (
    <div className="pdfjs-viewer" ref={viewerRef}>
      <div className="pdfjs-toolbar">
        <strong>PDF 미리보기</strong>
        <div className="pdfjs-controls">
          <button disabled={!canGoPrevious} onClick={() => setActivePage((page) => Math.max(1, page - 1))} type="button">
            이전
          </button>
          <span>{pageCount ? `${activePage} / ${pageCount}` : "불러오는 중"}</span>
          <button disabled={!canGoNext} onClick={() => setActivePage((page) => Math.min(pageCount, page + 1))} type="button">
            다음
          </button>
        </div>
      </div>
      {loading && <div className="pdfjs-state">PDF를 불러오는 중입니다.</div>}
      {error && <div className="pdfjs-state error">{error}</div>}
      <div className="pdf-page">
        <canvas ref={canvasRef} />
      </div>
      {error && fallbackText && <pre className="pdf-fallback-text">{fallbackText}</pre>}
    </div>
  );
}

function SourceModal({ document, onClose }) {
  const [usesMobilePdfFallback, setUsesMobilePdfFallback] = useState(false);

  useEffect(() => {
    if (!document) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [document, onClose]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia("(max-width: 760px), (pointer: coarse)");
    const updateMobilePdfFallback = () => setUsesMobilePdfFallback(mediaQuery.matches);

    updateMobilePdfFallback();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", updateMobilePdfFallback);
      return () => mediaQuery.removeEventListener("change", updateMobilePdfFallback);
    }
    mediaQuery.addListener(updateMobilePdfFallback);
    return () => mediaQuery.removeListener(updateMobilePdfFallback);
  }, []);

  if (!document) return null;

  const url = sourceUrl(document);
  const extension = fileExtension(document.fileName);
  const previewUrl = sourcePreviewUrl(document);
  const isMobilePdf = extension === "pdf" && usesMobilePdfFallback;
  const canPreview = (extension === "pdf" || extension === "hwp") && !isMobilePdf;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="source-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-modal-title"
      >
        <header className="source-modal-header">
          <div>
            <span className="eyeless-label">원문</span>
            <h2 id="source-modal-title">{documentDisplayName(document.fileName)}</h2>
            <p>{document.year || "미상"} · {document.session} · {document.subject} · {document.questionCount}문항</p>
          </div>
          <div className="source-modal-actions">
            <button className="icon-button" type="button" onClick={onClose} aria-label="원문 닫기">
              <X size={20} />
            </button>
          </div>
        </header>

        {canPreview ? (
          <iframe className="source-frame" title={`${document.fileName} 원문`} src={previewUrl} />
        ) : isMobilePdf ? (
          <div className="source-text-preview mobile-pdf-preview">
            <div className="mobile-pdf-notice">
              <strong>모바일 PDF 뷰어</strong>
              <p>PDF.js로 원본 PDF를 화면 안에서 바로 렌더링합니다. 브라우저가 렌더링을 지원하지 않으면 추출 텍스트로 대체됩니다.</p>
              <div className="mobile-pdf-actions">
                <a className="source-link" href={url} target="_blank" rel="noopener noreferrer">
                  <FileText size={17} /> 새 탭에서 PDF 열기
                </a>
                <a className="source-link" href={url} download={document.fileName}>
                  <Download size={17} /> 파일 다운로드
                </a>
              </div>
            </div>
            <PdfCanvasViewer fallbackText={document.rawText} url={url} />
          </div>
        ) : (
          <div className="source-text-preview">
            <p>이 형식은 브라우저 안에서 직접 미리보기를 지원하지 않아 추출된 텍스트를 표시합니다.</p>
            <pre>{document.rawText}</pre>
          </div>
        )}

        {!isMobilePdf && (
          <footer className="source-modal-footer">
            <a className="source-link" href={url} download={document.fileName}>
              <Download size={17} /> 파일 다운로드
            </a>
          </footer>
        )}
      </section>
    </div>
  );
}

const objectionStatusLabels = {
  new: "신규",
  progress: "처리 중",
  done: "완료",
};

function encodeBasicAuth(id, password) {
  const bytes = new TextEncoder().encode(`${id}:${password}`);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary);
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function AdminApp() {
  const [auth, setAuth] = useState(() => localStorage.getItem(ADMIN_AUTH_STORAGE_KEY) || "");
  const [objections, setObjections] = useState([]);
  const [status, setStatus] = useState(auth ? "loading" : "signed-out");
  const [error, setError] = useState("");

  const authHeaders = auth ? { authorization: `Basic ${auth}` } : {};

  const loadObjections = async (nextAuth = auth) => {
    setStatus("loading");
    setError("");
    try {
      const body = await requestJson("/api/admin/objections", {
        headers: { authorization: `Basic ${nextAuth}` },
      });
      setObjections(body.objections || []);
      setStatus("ready");
    } catch {
      localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
      setAuth("");
      setStatus("signed-out");
      setError("관리자 로그인이 필요합니다.");
    }
  };

  useEffect(() => {
    if (auth) loadObjections(auth);
  }, []);

  const login = async (id, password) => {
    setStatus("loading");
    setError("");
    try {
      await requestJson("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ id, password }),
      });
      const nextAuth = encodeBasicAuth(id, password);
      localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, nextAuth);
      setAuth(nextAuth);
      await loadObjections(nextAuth);
    } catch {
      setStatus("signed-out");
      setError("관리자 ID 또는 비밀번호가 올바르지 않습니다.");
    }
  };

  const logout = () => {
    localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
    setAuth("");
    setObjections([]);
    setStatus("signed-out");
  };

  const updateStatus = async (id, nextStatus) => {
    const before = objections;
    setObjections((items) =>
      items.map((item) => (item.id === id ? { ...item, status: nextStatus, updatedAt: Date.now() } : item)),
    );
    try {
      await requestJson(`/api/admin/objections/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch {
      const oldItem = before.find((item) => item.id === id);
      if (oldItem) {
        setObjections((items) =>
          items.map((item) =>
            item.id === id ? { ...item, status: oldItem.status, updatedAt: oldItem.updatedAt } : item,
          ),
        );
      }
      setError("처리 상태를 저장하지 못했습니다.");
    }
  };

  const counts = objections.reduce(
    (acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }),
    { new: 0, progress: 0, done: 0 },
  );

  if (!auth) {
    return <AdminLoginScreen error={error} loading={status === "loading"} onLogin={login} />;
  }

  return (
    <main className="app-shell admin-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><BookOpen size={22} /></span>
          <div>
            <h1>관리자 페이지</h1>
            <p>문제 이의제기 접수 내용을 확인하고 처리 상태를 관리합니다.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <a className="ghost-button" href="/">문제 풀이로 이동</a>
          <button className="ghost-button" type="button" onClick={() => loadObjections(auth)} disabled={status === "loading"}>새로고침</button>
          <button className="ghost-button" type="button" onClick={logout}>로그아웃</button>
        </div>
      </header>

      {error && <div className="sync-alert">{error}</div>}

      <section className="summary admin-summary">
        <div className="summary-copy">
          <h2>이의제기 {objections.length.toLocaleString()}건</h2>
          <p>초기 관리자 계정은 admin / admin 입니다. 운영 환경에서는 ADMIN_ID, ADMIN_PASSWORD 환경변수로 변경할 수 있습니다.</p>
        </div>
        <div className="metric-grid status-metrics">
          {Object.entries(objectionStatusLabels).map(([key, label]) => (
            <div className={`metric status-${key}`} key={key}>
              <strong>{counts[key] || 0}</strong>
              <p>{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="practice-panel admin-panel">
        {status === "loading" ? (
          <div className="empty-state compact">이의제기를 불러오는 중입니다.</div>
        ) : objections.length === 0 ? (
          <div className="empty-state compact">접수된 이의제기가 없습니다.</div>
        ) : (
          <div className="objection-list">
            {objections.map((item) => (
              <AdminObjectionCard item={item} key={item.id} onStatusChange={updateStatus} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function AdminLoginScreen({ error, loading, onLogin }) {
  const [id, setId] = useState("admin");
  const [password, setPassword] = useState("admin");

  const submit = (event) => {
    event.preventDefault();
    onLogin(id, password);
  };

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <span className="brand-mark"><BookOpen size={22} /></span>
        <h1>관리자 로그인</h1>
        <p>/admin 페이지는 관리자 로그인 후 이의제기 처리 상태를 관리할 수 있습니다.</p>
        <label className="login-field">
          <span>관리자 ID</span>
          <input autoFocus disabled={loading} onChange={(event) => setId(event.target.value)} value={id} />
        </label>
        <label className="login-field">
          <span>비밀번호</span>
          <input disabled={loading} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button className="primary-button login-button" disabled={loading} type="submit">
          {loading ? "확인 중" : "로그인"}
        </button>
      </form>
    </main>
  );
}

function AdminObjectionCard({ item, onStatusChange }) {
  const q = item.question || {};
  return (
    <article className={`admin-objection-card status-${item.status}`}>
      <header>
        <div>
          <div className="question-meta">
            <span>{q.year || "미상"}</span>
            <span>{q.session || "미상"}</span>
            <span>{q.subject || "미상"}</span>
            <span>{q.typeLabel || typeLabels[q.type] || q.type || "유형 미상"}</span>
            <span>문제 {q.number || "미상"}</span>
          </div>
          <h2>{q.title || "제목 없음"}</h2>
          <p className="admin-card-meta">작성자 {item.userId} · 접수 {formatDateTime(item.createdAt)} · 수정 {formatDateTime(item.updatedAt)}</p>
        </div>
        <div className="status-button-group" role="group" aria-label="처리 상태 변경">
          {Object.keys(objectionStatusLabels).map((status) => (
            <button
              className={item.status === status ? "active" : ""}
              key={status}
              type="button"
              onClick={() => onStatusChange(item.id, status)}
            >
              {objectionStatusLabels[status]}
            </button>
          ))}
        </div>
      </header>
      {q.body && <p className="admin-question-body">{q.body}</p>}
      <div className="admin-objection-message">
        <strong>이의제기 내용</strong>
        <p>{item.message}</p>
      </div>
      <footer>
        <span>{q.sourceTitle}</span>
        <span>{q.fileName}</span>
        <code>{item.answerKey}</code>
      </footer>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);
