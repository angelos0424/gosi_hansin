import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  FileText,
  Flag,
  ListFilter,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
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

function useStoredAnswers() {
  const [answers, setAnswers] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("prok-study-answers") || "{}");
    } catch {
      return {};
    }
  });

  const updateAnswer = (id, patch) => {
    setAnswers((current) => {
      const next = { ...current, [id]: { ...(current[id] || {}), ...patch } };
      localStorage.setItem("prok-study-answers", JSON.stringify(next));
      return next;
    });
  };

  const reset = () => {
    localStorage.removeItem("prok-study-answers");
    setAnswers({});
  };

  return [answers, updateAnswer, reset];
}

function normalizeQuestionText(question) {
  const base = question.body || question.text || "";
  if (!question.options?.length) return base;
  const marker = base.indexOf(question.options[0]);
  if (marker < 0) return base;
  return base.slice(0, marker).trim();
}

function App() {
  const [filters, setFilters] = useState(initialFilters);
  const [activeId, setActiveId] = useState(null);
  const [practiceSeed, setPracticeSeed] = useState(0);
  const [answers, updateAnswer, resetAnswers] = useStoredAnswers();

  const years = useMemo(
    () => [...new Set(data.questions.map((q) => q.year).filter(Boolean))].sort((a, b) => b - a),
    [],
  );

  const documentsById = useMemo(
    () => Object.fromEntries(data.documents.map((doc) => [doc.id, doc])),
    [],
  );

  const filteredQuestions = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return data.questions.filter((q) => {
      if (filters.subject !== "전체" && q.subject !== filters.subject) return false;
      if (filters.year !== "전체" && String(q.year) !== String(filters.year)) return false;
      if (filters.session !== "전체" && q.session !== filters.session) return false;
      if (filters.type !== "전체" && q.type !== filters.type) return false;
      if (!query) return true;
      return `${q.groupTitle || ""} ${q.title} ${q.body} ${q.text} ${q.sourceTitle} ${q.fileName} ${(q.displayLabel || q.numberLabel || q.number || "")}`.toLowerCase().includes(query);
    });
  }, [filters]);

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
  }, [filteredQuestions, practiceSeed]);

  const activeQuestion = useMemo(() => {
    return data.questions.find((q) => q.id === activeId) || practiceQuestions[0] || filteredQuestions[0];
  }, [activeId, practiceQuestions, filteredQuestions]);

  const stats = useMemo(() => {
    const completed = data.questions.filter((q) => answers[q.id]?.done).length;
    const flagged = data.questions.filter((q) => answers[q.id]?.flagged).length;
    return {
      documents: data.documents.length,
      questions: data.questions.length,
      completed,
      flagged,
    };
  }, [answers]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setActiveId(null);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={22} />
          </span>
          <div>
            <h1>목사고시 기출문제 학습실</h1>
            <p>2010-2026년 공개 기출문제를 연도와 과목별로 풀어보는 로컬 학습 사이트</p>
          </div>
        </div>
        <button className="ghost-button" onClick={() => setPracticeSeed((n) => n + 1)}>
          <Shuffle size={17} /> 새 문제 세트
        </button>
      </header>

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
        <aside className="sidebar">
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
            <Select label="과목" value={filters.subject} onChange={(v) => updateFilter("subject", v)}>
              <option>전체</option>
              <option>성경</option>
              <option>교단헌법</option>
            </Select>
            <Select label="연도" value={filters.year} onChange={(v) => updateFilter("year", v)}>
              <option>전체</option>
              {years.map((year) => (
                <option key={year}>{year}</option>
              ))}
            </Select>
            <Select label="회차" value={filters.session} onChange={(v) => updateFilter("session", v)}>
              <option>전체</option>
              <option>제1차</option>
              <option>제2차</option>
              <option>기타</option>
            </Select>
            <Select label="유형" value={filters.type} onChange={(v) => updateFilter("type", v)}>
              <option>전체</option>
              {Object.entries(typeLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <div className="source-list">
            <h3>문서 목록</h3>
            {data.documents.slice(0, 12).map((doc) => (
              <div className="source-row" key={doc.id}>
                <span>{doc.year || "미상"}</span>
                <p>{doc.subject}</p>
                <strong>{doc.questionCount}</strong>
              </div>
            ))}
          </div>
        </aside>

        <section className="practice-panel">
          <div className="panel-header">
            <div>
              <span className="eyeless-label">현재 세트</span>
              <h2>{filteredQuestions.length.toLocaleString()}개 중 {practiceQuestions.length}개 풀이</h2>
            </div>
            <button className="ghost-button small" onClick={resetAnswers}>
              <RotateCcw size={16} /> 기록 초기화
            </button>
          </div>

          <div className="question-layout">
            <nav className="question-rail" aria-label="문제 선택">
              {practiceQuestions.map((q, index) => (
                <button
                  key={q.id}
                  className={`rail-item ${activeQuestion?.id === q.id ? "active" : ""} ${
                    answers[q.id]?.done ? "done" : ""
                  }`}
                  onClick={() => setActiveId(q.id)}
                >
                  <span>{index + 1}</span>
                  <small>{q.subject}</small>
                </button>
              ))}
            </nav>

            {activeQuestion ? (
              <QuestionCard
                question={activeQuestion}
                answer={answers[activeQuestion.id] || {}}
                updateAnswer={(patch) => updateAnswer(activeQuestion.id, patch)}
                document={documentsById[activeQuestion.documentId]}
              />
            ) : (
              <div className="empty-state">조건에 맞는 문제가 없습니다.</div>
            )}
          </div>
        </section>
      </section>
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

function Select({ label, value, onChange, children }) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

function QuestionCard({ question, answer, updateAnswer, document }) {
  const prompt = normalizeQuestionText(question);

  return (
    <article className="question-card">
      <div className="question-meta">
        <span>{question.year}</span>
        <span>{question.session}</span>
        <span>{question.subject}</span>
        <span>{typeLabels[question.type]}</span>
      </div>

      {question.groupTitle && <div className="group-prompt">{question.groupTitle}</div>}

      <h3>
        <span>문제 {question.displayLabel || question.numberLabel || question.number}</span>문제 본문
      </h3>
      {question.title && (
        <div className="question-title">
          <strong>문항 제목</strong>
          <p>{question.title}</p>
        </div>
      )}
      {question.body && question.body !== question.title && <p className="question-body">{prompt}</p>}

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
        <button className={answer.done ? "primary-button done" : "primary-button"} onClick={() => updateAnswer({ done: !answer.done })}>
          <CheckCircle2 size={17} /> {answer.done ? "완료됨" : "완료 표시"}
        </button>
        <button className={answer.flagged ? "flag-button active" : "flag-button"} onClick={() => updateAnswer({ flagged: !answer.flagged })}>
          <Flag size={17} /> 복습
        </button>
        <a className="source-link" href={document ? `/${document.filePath}` : "#"} target="_blank" rel="noreferrer">
          <FileText size={17} /> 원문
        </a>
      </div>

      <footer className="question-source">
        <Clock3 size={15} />
        <span>{question.sourceTitle}</span>
        <span>{question.fileName}</span>
      </footer>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);
