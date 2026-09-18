# 🏛️ Architecture & System Design Documentation

This document provides an in-depth exploration of the internal subsystems, data flow pipelines, AI prompt engineering contracts, and security guardrails governing **API_Hashira**.

---

## 1. High-Level System Topography

```
                    ┌───────────────────────────────┐
                    │      Client Access Points     │
                    ├───────────────┬───────────────┤
                    │ Telegram App  │ Web Simulator │
                    │ (iOS/Android) │ (Desktop/Tab) │
                    └───────┬───────┴───────┬───────┘
                            │               │
                            ▼               ▼
                    ┌───────────────────────────────┐
                    │      Express Ingress Gateway  │
                    │         (Port 3000)           │
                    └───────┬───────────────┬───────┘
                            │               │
               Webhook Router               REST Endpoint
                     │                              │
                     ▼                              ▼
          ┌─────────────────────┐       ┌──────────────────────┐
          │ Document Guardrail  │       │ Candidate Ingestion  │
          │ Classifier Engine   │       │ & Document Storage   │
          └──────────┬──────────┘       └───────────┬──────────┘
                     │                              │
                     └──────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  Google Gemini 2.5 Flash SDK  │
                    │  (Structured JSON Schema API) │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  5-Factor Weighted Evaluator  │
                    │  • Technical Match (40%)      │
                    │  • Experience (25%)           │
                    │  • Alignment (20%)            │
                    │  • Education (10%)            │
                    │  • Formatting (5%)            │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
       ┌────────────────────────┐      ┌────────────────────────┐
       │   Telegram Formatter   │      │   Web Mini-App Payload │
       │ (MarkdownV2 + Keyboards│      │ (Recharts, SVG Gauges, │
       │   + Action Callback)   │      │   Ranking Data Model)  │
       └────────────────────────┘      └────────────────────────┘
```

---

## 2. Ingestion & Document Guardrail Engine

A critical vulnerability in recruiting bots is the "inverted input" problem: a user accidentally uploads a candidate resume into the Job Description vacancy slot (`/setjd`).

### Classification Heuristics:
1. **Resume Markers**: The presence of `Curriculum Vitae`, `GPA`, `Graduation Year`, `Contact Details`, `Skills:`, `Work History`, `Objective:` triggers a resume classification score.
2. **JD Markers**: The presence of `Job Title:`, `Responsibilities:`, `Qualifications Required:`, `Benefits:`, `Company Overview:`, `We are seeking:` triggers a vacancy classification score.
3. **Threshold Guardrail**: If an input submitted to `/setjd` registers a higher resume score than JD score, the system intercepts the update and returns a polite guidance notification without corrupting the active vacancy.

---

## 3. Gemini 2.5 Flash AI Structured Evaluation Schema

The backend uses the `@google/genai` SDK with strict JSON output schemas:

```typescript
export interface CandidateAnalysis {
  candidateName: string;
  atsScore: number;
  alignment: 'Excellent' | 'Strong' | 'Moderate' | 'Weak';
  scoringBreakdown: {
    technicalSkills: { score: number; maxScore: 40; details: string };
    experience: { score: number; maxScore: 25; details: string };
    jobAlignment: { score: number; maxScore: 20; details: string };
    education: { score: number; maxScore: 10; details: string };
    atsFormatting: { score: number; maxScore: 5; details: string };
  };
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  weaknesses: string[];
  atsImprovementTips: string[];
  customInterviewQuestions: string[];
}
```

---

## 4. Head-to-Head Comparative Benchmarking

When two or more resumes are loaded, the evaluation transitions from single-applicant scoring to a comparative benchmark.
- Identifies shared common ground (skills both candidates possess).
- Highlights decisive differentiators (critical competencies unique to one candidate).
- Ranks candidates in order of hiring readiness with clear trade-off summaries.
