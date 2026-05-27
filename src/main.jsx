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
  const [filters, setFilters] = useState(initialFilters);
  const [activeId, setActiveId] = useState(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [sourceDocument, setSourceDocument] = useState(null);
  const [practiceSeed, setPracticeSeed] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
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
      return filteredQuestions;
    }

    const constitutionQuestions = filteredQuestions.filter((q) => q.subject === "교단헌법");
    const bibleQuestions = filteredQuestions.filter((q) => q.subject === "성경");
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
    const leftovers = filteredQuestions.filter((q) => !selectedIds.has(q.id));
    const extra = takeRandom(leftovers, 30 - picked.length, (seed * 9301 + 49297) % 233280);
    return [...picked, ...extra];
  }, [filteredQuestions, practiceSeed, selectedDocumentId]);

  const activeQuestion = useMemo(() => {
    return practiceQuestions.find((q) => q.id === activeId) || practiceQuestions[0] || filteredQuestions[0];
  }, [activeId, practiceQuestions, filteredQuestions]);

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

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedDocumentId(null);
    setActiveId(null);
  };

  const refreshPracticeSet = () => {
    setSelectedDocumentId(null);
    setActiveId(null);
    setPracticeSeed((n) => n + 1);
  };

  const openDocumentQuestions = (doc) => {
    setSelectedDocumentId(doc.id);
    setFilters((current) => ({
      ...current,
      type: "전체",
      query: "",
    }));
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
              O/X, 서술형으로 분류했습니다. 답안은 브라우저에 자동 저장됩니다.
            </p>
          </div>
          <div className="metric-grid">
            <Metric label="문서" value={stats.documents} icon={<FileText size={18} />} />
            <Metric label="문제" value={stats.questions.toLocaleString()} icon={<ListFilter size={18} />} />
            <Metric label="완료" value={stats.completed} icon={<CheckCircle2 size={18} />} />
            <Metric label="복습" value={stats.flagged} icon={<Flag size={18} />} />
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

        <section className="practice-panel">
          <div className="panel-header">
            <div>
              <span className="eyeless-label">{selectedDocumentId ? "선택 문서" : "현재 세트"}</span>
              <h2>
                {selectedDocument
                  ? `${selectedDocument.year || "미상"} ${selectedDocument.session} ${selectedDocument.subject} ${practiceQuestions.length}개`
                  : `${filteredQuestions.length.toLocaleString()}개 중 ${practiceQuestions.length}개 풀이`}
              </h2>
            </div>
            <button className="ghost-button small" onClick={resetAnswers}>
              <RotateCcw size={16} /> 기록 초기화
            </button>
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
              />
            ) : (
              <div className="empty-state">조건에 맞는 문제가 없습니다.</div>
            )}
          </div>
        </section>
      </section>

      <SourceModal document={sourceDocument} onClose={() => setSourceDocument(null)} />
    </main>
  );
}

function Metric({ label, value, icon }) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <strong>{value}</strong>
      <p>{label}</p>
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

function QuestionCard({ question, answer, updateAnswer, document, openSource, onNext, hasNext }) {
  const prompt = normalizeQuestionText(question);
  const groupPrompt = question.groupTitle && question.groupTitle !== question.title ? question.groupTitle : "";

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

      {question.title && (
        <h3 className="question-title">{question.title}</h3>
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

      <label className="answer-box">
        <span>{question.type === "essay" ? "서술 답안" : "내 풀이 메모"}</span>
        <textarea
          value={answer.note || ""}
          onChange={(e) => updateAnswer({ note: e.target.value })}
          placeholder="여기에 답안을 작성하세요. 정답지는 원문에 없어서 자기 채점용으로 저장됩니다."
        />
      </label>

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
        </div>
      </div>

      <footer className="question-source">
        <Clock3 size={15} />
        <span>{question.sourceTitle}</span>
        <span>{question.fileName}</span>
      </footer>
    </article>
  );
}

function SourceModal({ document, onClose }) {
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

  if (!document) return null;

  const url = sourceUrl(document);
  const extension = fileExtension(document.fileName);
  const previewUrl = sourcePreviewUrl(document);
  const canPreview = extension === "pdf" || extension === "hwp";

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
        ) : (
          <div className="source-text-preview">
            <p>이 형식은 브라우저 안에서 직접 미리보기를 지원하지 않아 추출된 텍스트를 표시합니다.</p>
            <pre>{document.rawText}</pre>
          </div>
        )}

        <footer className="source-modal-footer">
          <a className="source-link" href={url} download={document.fileName}>
            <Download size={17} /> 파일 다운로드
          </a>
        </footer>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
