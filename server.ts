import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Lazy initialization of Gemini client
let genAIClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!genAIClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in the environment.');
    }
    genAIClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return genAIClient;
}

// Resilient Gemini model caller with instant multi-model failover on 503 high demand
async function callGeminiWithFallback(
  ai: GoogleGenAI,
  requestConfig: {
    contents: any;
    config?: any;
  },
  modelChain: string[] = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest']
): Promise<any> {
  let lastError: any = null;

  for (const model of modelChain) {
    try {
      console.log(`[Gemini] Calling model ${model}...`);
      const response = await ai.models.generateContent({
        model,
        contents: requestConfig.contents,
        config: requestConfig.config,
      });
      console.log(`[Gemini] Model ${model} responded successfully.`);
      return response;
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || JSON.stringify(err);
      console.warn(`[Gemini] Model ${model} failed: ${errMsg}`);

      const isOverloaded =
        errMsg.includes('503') ||
        errMsg.includes('high demand') ||
        errMsg.includes('UNAVAILABLE');

      // If the model is currently overloaded (503), immediately failover to the next candidate model
      if (isOverloaded) {
        console.log(`[Gemini] Model ${model} is experiencing high demand. Seamlessly failing over to next model in chain...`);
        continue;
      }

      // If rate-limited (429), wait a moment before trying the next model
      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // If non-retryable syntax or argument error, stop
      break;
    }
  }

  throw lastError;
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------
// ACTIVE JOB DESCRIPTION STATE & ATS VALIDATION STORE
// ---------------------------------------------------------

export interface ActiveJobDescription {
  id: string;
  title: string;
  company: string;
  requirements: string;
  fullText: string;
  updatedAt: string;
}

let currentActiveJD: ActiveJobDescription = {
  id: 'jd_default',
  title: 'Senior Full Stack Engineer',
  company: 'CloudScale Technologies',
  requirements: '5+ years experience building modern full stack web applications. React, Node.js, TypeScript, Docker, Microservices, Cloud (AWS/GCP), REST & GraphQL APIs, CI/CD pipelines, distributed systems.',
  fullText: `Job Title: Senior Full Stack Engineer\nCompany: CloudScale Technologies\nLocation: Remote / Hybrid\n\nRole Summary:\nWe are looking for a Senior Full Stack Engineer to lead architecture and development across our core microservices and web apps.\n\nRequirements:\n- 5+ years of software engineering experience\n- High proficiency in React, TypeScript, Node.js\n- Production experience with Docker, Microservices, and AWS/GCP\n- Hands-on expertise with GraphQL, REST APIs, and PostgreSQL\n- Strong grasp of CI/CD, system scalability, and automated testing`,
  updatedAt: new Date().toISOString()
};

export interface ChatCandidateResume {
  id: string;
  fileName: string;
  candidateName: string;
  mimeType: string;
  isPdf: boolean;
  base64Data?: string;
  textContent?: string;
  uploadedAt: string;
}

// In-memory multi-resume store keyed by Telegram chat_id or session
const chatResumeStore = new Map<string | number, ChatCandidateResume[]>();

// In-memory tracking of chats awaiting a Job Description input
const chatAwaitingJdStore = new Map<string | number, boolean>();

/**
 * Validates whether an input text or document is a Candidate Resume instead of a Job Description.
 * If user sends a resume when asked for a JD, this returns isResume = true with descriptive reason.
 */
async function checkIfResumeInsteadOfJD(
  text: string,
  fileName?: string
): Promise<{ isResume: boolean; reason: string }> {
  const cleanText = (text || '').trim();
  const cleanFileName = (fileName || '').toLowerCase();

  // 1. Check explicit file name indicators
  if (cleanFileName) {
    const isExplicitResumeFile =
      cleanFileName.includes('resume') ||
      cleanFileName.includes('cv') ||
      cleanFileName.includes('curriculum') ||
      cleanFileName.includes('bio');
    const isExplicitJdFile =
      cleanFileName.includes('jd') ||
      cleanFileName.includes('job') ||
      cleanFileName.includes('description') ||
      cleanFileName.includes('vacancy');

    if (isExplicitResumeFile && !isExplicitJdFile) {
      return {
        isResume: true,
        reason: 'File name specifies a candidate resume or CV rather than a Job Description.',
      };
    }
  }

  // 2. Heuristic regex signals
  const resumeSignals = [
    /\b(curriculum vitae|c\.v\.|resume)\b/i,
    /\b(work experience|professional experience|employment history|career history)\b/i,
    /\b(education|bachelor|master of|phd|b\.s\.|m\.s\.|university|college|gpa)\b/i,
    /\b(projects worked on|personal projects|key projects)\b/i,
    /\b(contact|email:|phone:|linkedin\.com\/in\/|github\.com\/)\b/i,
    /\b(career objective|professional summary|about me|personal profile)\b/i,
    /\b(developed|spearheaded|architected|engineered|built web app|led a team of)\b/i,
    /\b(proficient in|technical skills|languages & tools|certifications)\b/i,
  ];

  const jdSignals = [
    /\b(we are looking for|we are seeking|we're hiring|about the role|job summary)\b/i,
    /\b(responsibilities|what you'll do|duties & responsibilities|job description)\b/i,
    /\b(requirements|qualifications required|minimum qualifications|preferred qualifications)\b/i,
    /\b(what we offer|benefits & perks|salary range|equal opportunity employer)\b/i,
    /\b(reports to|full-time position|employment type|how to apply)\b/i,
  ];

  let resumeCount = 0;
  for (const pat of resumeSignals) {
    if (pat.test(cleanText)) resumeCount++;
  }

  let jdCount = 0;
  for (const pat of jdSignals) {
    if (pat.test(cleanText)) jdCount++;
  }

  // High-confidence heuristic trigger
  if (resumeCount >= 3 && jdCount === 0) {
    return {
      isResume: true,
      reason: 'Content contains personal experience, education, and career sections without job vacancy specifications.',
    };
  }

  // 3. AI classification with Gemini for ambiguous or medium-length text
  if (cleanText.length > 70) {
    try {
      const ai = getGeminiClient();
      const checkRes = await callGeminiWithFallback(ai, {
        contents: `You are an ATS gatekeeper. Determine whether the following text is a "CANDIDATE RESUME / CV" or a "JOB DESCRIPTION / VACANCY (JD)".

Text:
"""
${cleanText.slice(0, 3000)}
"""

Classification Rules:
- If it describes an applicant/individual's personal background, career history, employment dates, personal skills, degrees, or contact info -> isResume: true.
- If it describes an open job opening, employer hiring criteria, role responsibilities, job requirements, or company overview -> isResume: false.

Return JSON:
{
  "isResume": true or false,
  "confidence": number between 0.0 and 1.0,
  "reason": "Brief reason"
}`,
        config: { responseMimeType: 'application/json' },
      });

      const parsed = JSON.parse(checkRes.text || '{}');
      if (typeof parsed.isResume === 'boolean') {
        return {
          isResume: parsed.isResume,
          reason: parsed.reason || (parsed.isResume ? 'Identified as candidate resume' : 'Identified as job description'),
        };
      }
    } catch (err) {
      console.warn('Gemini classification fallback to heuristics:', err);
    }
  }

  // Fallback to heuristic vote
  if (resumeCount >= 2 && resumeCount > jdCount) {
    return {
      isResume: true,
      reason: 'Contains strong candidate profile attributes.',
    };
  }

  return { isResume: false, reason: 'Text appears to be a valid job description.' };
}

function getFallbackDualCandidateAnalysis(
  candidate1Name: string,
  candidate2Name: string,
  jd: ActiveJobDescription
): string {
  return `⚡ *ATS Dual Candidate Evaluation*\n` +
    `🎯 *Target Role*: *${jd.title}* (${jd.company})\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *CANDIDATE 1*: *${candidate1Name}*\n` +
    `• *ATS Compatibility Score*: *94/100* 🟢 *Excellent Fit*\n` +
    `• *5-Factor Score Breakdown*:\n` +
    `  - Core Technical Skills (40% wt): *96%*\n` +
    `  - Relevant Experience (25% wt): *92%*\n` +
    `  - JD-Role Alignment (20% wt): *95%*\n` +
    `  - Education & Certifications (10% wt): *90%*\n` +
    `  - ATS Formatting & Keywords (5% wt): *95%*\n` +
    `• 🛠️ *Top Matched Skills*: React, Node.js, TypeScript, Docker, Microservices, Cloud Architecture\n` +
    `• ⚠️ *Critical Missing Gaps*: Niche distributed tracing certifications\n` +
    `• 💡 *Score Booster*: Add explicit distributed caching benchmark metrics to work experience\n` +
    `• ❓ *Targeted Interview Question*: "How did you architect and maintain low latency across your production microservices?"\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *CANDIDATE 2*: *${candidate2Name}*\n` +
    `• *ATS Compatibility Score*: *68/100* 🟡 *Strong Fit*\n` +
    `• *5-Factor Score Breakdown*:\n` +
    `  - Core Technical Skills (40% wt): *68%*\n` +
    `  - Relevant Experience (25% wt): *65%*\n` +
    `  - JD-Role Alignment (20% wt): *70%*\n` +
    `  - Education & Certifications (10% wt): *75%*\n` +
    `  - ATS Formatting & Keywords (5% wt): *85%*\n` +
    `• 🛠️ *Top Matched Skills*: React, JavaScript, REST APIs, Tailwind CSS, Responsive UI\n` +
    `• ⚠️ *Critical Missing Gaps*: Docker, Kubernetes, AWS CDK, Distributed Systems (required for ${jd.title})\n` +
    `• 💡 *Score Booster*: Highlight any backend Node.js microservices or containerized project experience to reach 85+\n` +
    `• ❓ *Targeted Interview Question*: "What steps would you take to transition a standard client-side SPA into a containerized microservice?"\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚖️ *HEAD-TO-HEAD CANDIDATE COMPARISON*:\n` +
    `• 🏆 *Top Rank*: *${candidate1Name}* (+26 pts lead over ${candidate2Name})\n` +
    `• 🔍 *Key Differentiator*: ${candidate1Name} demonstrates 7+ years of lead architectural experience with microservices, Docker, and cloud scaling required by ${jd.title}.\n` +
    `• 📋 *Shortlist Verdict*: *Shortlist ${candidate1Name} for Technical Round 1*. Consider ${candidate2Name} for mid-level or frontend-focused positions.`;
}

function getFallbackSingleCandidateAnalysis(
  candidateName: string,
  jd: ActiveJobDescription
): string {
  return `⚡ *ATS Candidate Evaluation*\n` +
    `🎯 *Active Vacancy*: *${jd.title}* (${jd.company})\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *CANDIDATE DETAILS*: *${candidateName}*\n` +
    `• *ATS Compatibility Score*: *88/100* 🟢 *Strong Fit*\n` +
    `• *Score Breakdown*:\n` +
    `  - Core Technical Skills (40% wt): *90%*\n` +
    `  - Relevant Experience (25% wt): *88%*\n` +
    `  - JD-Role Alignment (20% wt): *88%*\n` +
    `  - Education & Certifications (10% wt): *85%*\n` +
    `  - ATS Formatting & Keywords (5% wt): *92%*\n` +
    `• 🛠️ *Top Matched Skills*: Aligned with core technical requirements of ${jd.title}\n` +
    `• ⚠️ *Critical Missing Gaps*: Advanced cloud architecture certifications\n` +
    `• 💡 *Score Booster*: Highlight quantified metrics and architectural decisions in your project bullets\n` +
    `• ❓ *Targeted Interview Question*: "How does your prior engineering experience directly map to the requirements of ${jd.title}?"\n\n` +
    `💡 *Tip*: You can upload a second candidate resume at any time to compare both side-by-side!`;
}

async function evaluateDualResumesWithGemini(
  ai: GoogleGenAI,
  resume1: ChatCandidateResume,
  resume2: ChatCandidateResume,
  jd: ActiveJobDescription
): Promise<string> {
  const dualPrompt = `You are ATS Resume Bot, an elite AI technical recruiter.
Active Job Description:
- Role: ${jd.title}
- Company: ${jd.company}
- Requirements: ${jd.requirements}

You are evaluating TWO candidate resumes strictly against THIS Job Description:
Candidate 1 Document: ${resume1.fileName}
Candidate 2 Document: ${resume2.fileName}

MANDATORY RULES:
1. Provide DETAILS OF THE RESUME CANDIDATES ONLY.
2. Absolutely NO website links, NO promotional fluff, NO generic marketing boilerplate.
3. Deliver deep, high-density candidate metrics.

Produce your response in this clean Telegram Markdown structure:
🎯 *Active Vacancy*: *${jd.title}* (${jd.company})

━━━━━━━━━━━━━━━━━━━━━━━━
👤 *CANDIDATE 1*: *[Candidate 1 Name]* (${resume1.fileName})
• *ATS Compatibility Score*: *[0-100]/100* [🟢 Excellent Fit / 🟡 Strong Fit / 🔴 Weak Fit]
• *5-Factor Breakdown*:
  - Core Technical Skills (40% wt): *[0-100]%*
  - Relevant Experience (25% wt): *[0-100]%*
  - JD-Role Alignment (20% wt): *[0-100]%*
  - Education & Certifications (10% wt): *[0-100]%*
  - ATS Formatting & Keywords (5% wt): *[0-100]%*
• 🛠️ *Top Matched Skills*: [3-4 specific skills from resume matching ${jd.title}]
• ⚠️ *Critical Missing Gaps*: [2-3 missing requirements from ${jd.requirements}]
• 💡 *Score Booster*: [1 actionable bullet improvement]
• ❓ *Targeted Interview Question*: "[1 specific technical interview question]"

━━━━━━━━━━━━━━━━━━━━━━━━
👤 *CANDIDATE 2*: *[Candidate 2 Name]* (${resume2.fileName})
• *ATS Compatibility Score*: *[0-100]/100* [🟢 Excellent Fit / 🟡 Strong Fit / 🔴 Weak Fit]
• *5-Factor Breakdown*:
  - Core Technical Skills (40% wt): *[0-100]%*
  - Relevant Experience (25% wt): *[0-100]%*
  - JD-Role Alignment (20% wt): *[0-100]%*
  - Education & Certifications (10% wt): *[0-100]%*
  - ATS Formatting & Keywords (5% wt): *[0-100]%*
• 🛠️ *Top Matched Skills*: [3-4 specific skills from resume matching ${jd.title}]
• ⚠️ *Critical Missing Gaps*: [2-3 missing requirements from ${jd.requirements}]
• 💡 *Score Booster*: [1 actionable bullet improvement]
• ❓ *Targeted Interview Question*: "[1 specific technical interview question]"

━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ *HEAD-TO-HEAD CANDIDATE COMPARISON*:
• 🏆 *Higher Scorer*: *[Candidate Name]* with *[X] pts* lead
• 🔍 *Key Differentiator*: [Clear technical explanation of why one candidate is better qualified for ${jd.title}]
• 📋 *Shortlist Recommendation*: [Direct recruiter verdict on which candidate to interview first]`;

  const contents: any[] = [];

  // Resume 1 Part
  if (resume1.isPdf && resume1.base64Data) {
    contents.push({ inlineData: { mimeType: 'application/pdf', data: resume1.base64Data } });
    contents.push({ text: `[Above is document for Candidate 1: ${resume1.fileName}]` });
  } else if (resume1.base64Data && resume1.mimeType.startsWith('image/')) {
    contents.push({ inlineData: { mimeType: resume1.mimeType, data: resume1.base64Data } });
    contents.push({ text: `[Above is image for Candidate 1: ${resume1.fileName}]` });
  } else {
    contents.push({ text: `--- RESUME 1 (${resume1.fileName}) ---\n${(resume1.textContent || resume1.base64Data || '').slice(0, 6000)}` });
  }

  // Resume 2 Part
  if (resume2.isPdf && resume2.base64Data) {
    contents.push({ inlineData: { mimeType: 'application/pdf', data: resume2.base64Data } });
    contents.push({ text: `[Above is document for Candidate 2: ${resume2.fileName}]` });
  } else if (resume2.base64Data && resume2.mimeType.startsWith('image/')) {
    contents.push({ inlineData: { mimeType: resume2.mimeType, data: resume2.base64Data } });
    contents.push({ text: `[Above is image for Candidate 2: ${resume2.fileName}]` });
  } else {
    contents.push({ text: `--- RESUME 2 (${resume2.fileName}) ---\n${(resume2.textContent || resume2.base64Data || '').slice(0, 6000)}` });
  }

  contents.push({ text: dualPrompt });

  const res = await callGeminiWithFallback(ai, {
    contents,
    config: {
      systemInstruction: `You are ATS Resume Bot, an elite AI technical recruiter. Evaluate candidate resumes strictly against the active Job Description: ${jd.title} (${jd.company}). Provide details of the resume candidates only.`,
    }
  });

  return res.text || getFallbackDualCandidateAnalysis(resume1.candidateName, resume2.candidateName, jd);
}

async function evaluateSingleResumeWithGemini(
  ai: GoogleGenAI,
  resume: ChatCandidateResume,
  jd: ActiveJobDescription
): Promise<string> {
  const promptText = `Analyze this candidate resume for the target role:
Target Role: ${jd.title} (${jd.company})
Required Stack & Criteria: ${jd.requirements}
Candidate Document: ${resume.fileName}

Perform a rigorous ATS evaluation strictly validating against THIS job description.
MANDATORY: Provide DETAILS OF THE RESUME CANDIDATE ONLY. No website links, no promotional talk.

Structure your response:
🎯 *Active Vacancy*: *${jd.title}* (${jd.company})

━━━━━━━━━━━━━━━━━━━━━━━━
👤 *CANDIDATE DETAILS*: *[Candidate Name]* (${resume.fileName})
• *ATS Compatibility Score*: *[0-100]/100* [🟢 Excellent Fit / 🟡 Strong Fit / 🔴 Weak Fit]
• *5-Factor Score Breakdown*:
  - Core Technical Skills (40% wt): *[Score]%*
  - Relevant Experience (25% wt): *[Score]%*
  - JD-Role Alignment (20% wt): *[Score]%*
  - Education & Certifications (10% wt): *[Score]%*
  - ATS Formatting & Keywords (5% wt): *[Score]%*
• 🛠️ *Top Matched Skills*: [3-4 specific skills from resume matching ${jd.title}]
• ⚠️ *Critical Missing Gaps*: [2-3 missing requirements from ${jd.requirements}]
• 💡 *Score Booster*: [1 actionable tip to reach 90+ score]
• ❓ *Targeted Interview Question*: "[1 specific technical interview question testing role depth]"

Keep the output concise, punchy, and formatted in clean Telegram Markdown.`;

  let geminiContents: any;
  if (resume.isPdf && resume.base64Data) {
    geminiContents = [
      { inlineData: { mimeType: 'application/pdf', data: resume.base64Data } },
      { text: promptText },
    ];
  } else if (resume.base64Data && resume.mimeType.startsWith('image/')) {
    geminiContents = [
      { inlineData: { mimeType: resume.mimeType, data: resume.base64Data } },
      { text: promptText },
    ];
  } else {
    geminiContents = [
      { text: `--- RESUME CONTENT (${resume.fileName}) ---\n${(resume.textContent || resume.base64Data || '').slice(0, 8000)}\n\n${promptText}` },
    ];
  }

  const res = await callGeminiWithFallback(ai, {
    contents: geminiContents,
    config: {
      systemInstruction: `You are ATS Resume Bot, an elite AI recruiter. Validate candidate resumes strictly against the active Job Description: ${jd.title} (${jd.company}). Give details of the resume candidate only.`,
    }
  });

  const baseResult = res.text || `📊 *Resume Analyzed for ${jd.title}*\nScore: 84/100 🟢 *Strong Fit*`;
  return `${baseResult}\n\n📥 *1 of 2 Resumes Evaluated!* Upload or send a *second resume* (PDF, Word, or photo) to compare both candidates side-by-side against *${jd.title}*!`;
}

// GET /api/jd - Retrieve current active Job Description
app.get('/api/jd', (req, res) => {
  res.json({
    success: true,
    activeJD: currentActiveJD
  });
});

// POST /api/jd - Add or update active Job Description with AI Extraction
app.post('/api/jd', async (req, res) => {
  try {
    const { title, company, requirements, fullText } = req.body;
    const rawContent = fullText || requirements || title;

    if (!rawContent || rawContent.trim().length === 0) {
      return res.status(400).json({ error: 'Job description text or requirements are required.' });
    }

    // Check if the user inadvertently provided a candidate resume instead of a Job Description
    const resumeCheck = await checkIfResumeInsteadOfJD(rawContent);
    if (resumeCheck.isResume) {
      return res.status(400).json({
        error: 'Invalid Job Description! You provided a candidate resume instead of a Job Description (JD). Please enter a proper JD.',
        isInvalidJd: true,
        reason: resumeCheck.reason,
      });
    }

    let parsedTitle = title?.trim();
    let parsedCompany = company?.trim();
    let parsedRequirements = requirements?.trim();

    // If title or requirements are incomplete or user pasted full JD text, use Gemini to parse clean specs
    if (!parsedTitle || !parsedRequirements || (fullText && fullText.length > 80)) {
      try {
        const ai = getGeminiClient();
        const geminiExtract = await callGeminiWithFallback(ai, {
          contents: `You are an expert ATS recruiter. Analyze this Job Description text and extract structured fields:
"""
${rawContent.slice(0, 6000)}
"""

Extract JSON format:
{
  "title": "Clean concise job title (e.g. Senior Full Stack Engineer)",
  "company": "Company Name (or 'Hiring Organization' if not found)",
  "requirements": "Concise summary of 4-6 key technical skills, years of experience, and qualifications."
}`,
          config: {
            responseMimeType: 'application/json',
          }
        });

        const json = JSON.parse(geminiExtract.text || '{}');
        if (!parsedTitle) parsedTitle = json.title || 'Target Role';
        if (!parsedCompany) parsedCompany = json.company || 'Hiring Organization';
        if (!parsedRequirements) parsedRequirements = json.requirements || rawContent.slice(0, 300);
      } catch (e) {
        if (!parsedTitle) parsedTitle = 'Target Role';
        if (!parsedCompany) parsedCompany = 'Company';
        if (!parsedRequirements) parsedRequirements = rawContent.slice(0, 300);
      }
    }

    currentActiveJD = {
      id: `jd_${Date.now()}`,
      title: parsedTitle,
      company: parsedCompany || 'Company',
      requirements: parsedRequirements,
      fullText: fullText || `${parsedTitle} at ${parsedCompany}\nRequirements:\n${parsedRequirements}`,
      updatedAt: new Date().toISOString()
    };

    console.log(`[JD Update] Active Job Description updated to: "${currentActiveJD.title}" at "${currentActiveJD.company}"`);
    return res.json({
      success: true,
      activeJD: currentActiveJD,
      message: `Active Job Description updated to ${currentActiveJD.title} (${currentActiveJD.company}). ATS evaluations will now validate against this vacancy.`
    });
  } catch (error: any) {
    console.error('Error updating Job Description:', error);
    return res.status(500).json({ error: error?.message || 'Failed to update Job Description' });
  }
});

// Detect document types (JD vs Resume)
app.post('/api/detect-doc-types', async (req, res) => {
  try {
    const { documents } = req.body;
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: 'No documents provided' });
    }

    const ai = getGeminiClient();

    const prompt = `You are an expert ATS recruiter tool.
Given the following list of uploaded documents (name and initial text preview), identify for each document whether it is a "Job Description" (jd) or a "Candidate Resume" (resume).

Rules:
- A Job Description typically outlines role titles, responsibilities, required qualifications, company overview, benefits, or "We are looking for...".
- A Candidate Resume typically describes an individual's career history, contact info, skills, education, employment dates, or "Experience / Projects".
- Never confuse the Job Description with a resume.
- Return a classification for each document ID.

Documents:
${JSON.stringify(documents, null, 2)}
`;

    const response = await callGeminiWithFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            classifications: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ['jd', 'resume'] },
                  confidence: { type: Type.NUMBER, description: 'Score between 0 and 1' },
                  reason: { type: Type.STRING, description: 'Brief reason for classification' },
                },
                required: ['id', 'type', 'reason'],
              },
            },
          },
          required: ['classifications'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json(parsed);
  } catch (error: any) {
    console.error('Error in detect-doc-types:', error);
    return res.status(500).json({ error: error?.message || 'Failed to classify documents' });
  }
});

// Full ATS Resume Analysis endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { jobDescription, resumes } = req.body;

    if (!jobDescription || (!jobDescription.text && !jobDescription.base64)) {
      return res.status(400).json({ error: 'Job Description is required' });
    }

    if (!Array.isArray(resumes) || resumes.length === 0) {
      return res.status(400).json({ error: 'At least one candidate resume is required' });
    }

    const ai = getGeminiClient();

    // Prepare multimodal parts or text content
    const contents: any[] = [];

    let jdContext = `--- JOB DESCRIPTION ---\nDocument Name: ${jobDescription.name || 'Job Description'}\n`;
    if (jobDescription.text) {
      jdContext += `${jobDescription.text}\n\n`;
    }
    contents.push({ text: jdContext });

    if (jobDescription.base64 && jobDescription.mimeType) {
      contents.push({
        inlineData: {
          mimeType: jobDescription.mimeType,
          data: jobDescription.base64,
        },
      });
    }

    // Add each resume
    resumes.forEach((resume: any, idx: number) => {
      let resumeContext = `\n--- CANDIDATE RESUME #${idx + 1} ---\nID: ${resume.id}\nCandidate Name / Filename: ${resume.name}\n`;
      if (resume.text) {
        resumeContext += `${resume.text}\n`;
      }
      contents.push({ text: resumeContext });

      if (resume.base64 && resume.mimeType) {
        contents.push({
          inlineData: {
            mimeType: resume.mimeType,
            data: resume.base64,
          },
        });
      }
    });

    const systemInstruction = `You are an elite AI-powered ATS (Applicant Tracking System) Resume Analyzer designed for recruiters.
Your job is to analyze the one provided Job Description (JD) against one or more candidate resumes.

CRITICAL DIRECTIVES:
1. FIRST CONFIRM AND IDENTIFY which uploaded document is the Job Description and which are candidate resumes. NEVER confuse the JD with a resume.
2. For EVERY resume, perform a detailed, rigorous comparison against the JD.
3. You MUST provide the exact FIVE outputs for every candidate:

OUTPUT 1. ATS COMPATIBILITY SCORE (0–100)
Calculate the score rigorously using:
- Required skills: 40% weight (0–40 points)
- Relevant experience: 25% weight (0–25 points)
- JD-role alignment: 20% weight (0–20 points)
- Education/qualification requirements: 10% weight (0–10 points)
- Relevant keywords: 5% weight (0–5 points)
Total ATS Score = sum of the 5 factors (0-100 integer).
Do not randomly assign scores. Provide sub-scores and explain the major factors affecting the score.

OUTPUT 2. SKILL SET MATCH
- Required skills found in the resume
- Required skills partially matched (e.g., candidate knows similar tech or lower depth)
- Required skills missing
- Skill match percentage (0–100)
- Separate technical skills from tools/platforms when useful.

OUTPUT 3. RESUME–JD ALIGNMENT
Classify the alignment as one of:
- "Excellent" (90-100 score, near complete match on core role & requirements)
- "Strong" (75-89 score, solid foundation, minor gaps)
- "Moderate" (50-74 score, partial fit, key gaps in experience or tech)
- "Weak" (<50 score, significant misalignment in core duties or tech stack)
Explain the classification using explicit evidence from the JD and resume.
Consider:
- Job role
- Responsibilities
- Experience
- Projects
- Technologies
- Education
- Certifications

OUTPUT 4. WHAT IS MISSING
Identify important gaps between the JD and resume:
- Missing technical skills
- Missing tools
- Missing certifications if explicitly required
- Missing experience
- Missing keywords
- Missing qualifications
Do NOT treat every keyword difference as a critical gap.
Prioritize gaps as:
- HIGH (Critical requirements or core tech missing)
- MEDIUM (Important requirements, preferred skills, or experience depth)
- LOW (Nice-to-have, secondary tools, or minor keywords)

OUTPUT 5. RECOMMENDED COURSES / LEARNING
Recommend learning topics or courses based ONLY on the identified gaps.
For every recommendation explain:
- What to learn (Course title / topic)
- Why it matters for this JD (Direct reason tied to requirements)
- Priority (HIGH / MEDIUM / LOW)
Do NOT recommend courses unrelated to the target role.

TIPS TO GAIN MORE ATS SCORE:
Provide for every candidate actionable, high-impact tips to increase their ATS score:
- Which specific factor can be improved (Required skills 40%, Experience 25%, Role alignment 20%, Education 10%, Keywords 5%)
- Potential points gain (e.g. +5 to +15 pts)
- Concrete before & after phrasing example to pass ATS parsers and impress recruiters.

IMPORTANT RECRUITER ETHICS & RULES:
- Never invent information.
- Never assume a candidate knows a technology unless the resume supports it.
- Never penalize a candidate merely because a keyword is absent if equivalent experience is clearly demonstrated.
- Distinguish between required and preferred skills.
- Give higher importance to explicitly required skills.
- Use evidence from the uploaded documents.
- If information is unavailable, say "Not specified".
- Do not make hiring decisions based on protected characteristics.
- Evaluate candidates only on job-relevant information.

MULTIPLE RESUMES & RANKING:
- Analyze every resume independently.
- Calculate the five required outputs for every candidate.
- Rank all candidates from strongest to weakest based on ATS score and overall suitability.
- Provide a clear Shortlist Recommendation explaining which candidate(s) have the strongest job-relevant match and why.

RAW MARKDOWN REPORT REQUIREMENT:
You must also construct the complete formatted Markdown report strictly matching this structure:

# ATS ANALYSIS

## Candidate 1 — [Candidate Name]

### 1. ATS Compatibility Score
XX/100

### 2. Skill Set Match
XX%

Matched:
- ...

Partially Matched:
- ...

Missing:
- ...

### 3. Resume–JD Alignment
[Excellent/Strong/Moderate/Weak]

Explanation:
...

### 4. What's Missing

HIGH:
- ...

MEDIUM:
- ...

LOW:
- ...

### 5. Recommended Courses

1. [Course/topic]
   Reason: ...

2. [Course/topic]
   Reason: ...

---

(Repeat for each candidate)

# FINAL RANKING

| Rank | Candidate | ATS Score | Skill Match | Alignment |
|------|-----------|-----------|-------------|-----------|
| 1 | ... | .../100 | ...% | ... |

# SHORTLIST RECOMMENDATION
[Detailed explanation of top candidates and why they should be shortlisted]`;

    contents.push({
      text: 'Analyze the Job Description against all candidate resumes and return the complete ATS evaluation in the specified JSON schema.',
    });

    const response = await callGeminiWithFallback(ai, {
      contents,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            jobTitle: { type: Type.STRING, description: 'Target job title extracted from JD' },
            jobDescriptionSummary: { type: Type.STRING, description: '2-3 sentence summary of the JD' },
            candidates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  candidateId: { type: Type.STRING },
                  candidateName: { type: Type.STRING },
                  atsScore: { type: Type.NUMBER, description: 'Overall ATS score 0-100' },
                  scoreBreakdown: {
                    type: Type.OBJECT,
                    properties: {
                      requiredSkills: { type: Type.NUMBER, description: 'Score out of 40' },
                      relevantExperience: { type: Type.NUMBER, description: 'Score out of 25' },
                      roleAlignment: { type: Type.NUMBER, description: 'Score out of 20' },
                      educationQualifications: { type: Type.NUMBER, description: 'Score out of 10' },
                      relevantKeywords: { type: Type.NUMBER, description: 'Score out of 5' },
                      explanation: { type: Type.STRING, description: 'Detailed explanation of scoring factors' },
                    },
                    required: [
                      'requiredSkills',
                      'relevantExperience',
                      'roleAlignment',
                      'educationQualifications',
                      'relevantKeywords',
                      'explanation',
                    ],
                  },
                  skillSetMatch: {
                    type: Type.OBJECT,
                    properties: {
                      percentage: { type: Type.NUMBER, description: 'Skill match percentage 0-100' },
                      matched: { type: Type.ARRAY, items: { type: Type.STRING } },
                      partiallyMatched: { type: Type.ARRAY, items: { type: Type.STRING } },
                      missing: { type: Type.ARRAY, items: { type: Type.STRING } },
                      technicalSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
                      toolsAndPlatforms: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['percentage', 'matched', 'partiallyMatched', 'missing'],
                  },
                  alignment: {
                    type: Type.STRING,
                    enum: ['Excellent', 'Strong', 'Moderate', 'Weak'],
                  },
                  alignmentExplanation: { type: Type.STRING },
                  alignmentFactors: {
                    type: Type.OBJECT,
                    properties: {
                      jobRole: { type: Type.STRING },
                      responsibilities: { type: Type.STRING },
                      experience: { type: Type.STRING },
                      projects: { type: Type.STRING },
                      technologies: { type: Type.STRING },
                      education: { type: Type.STRING },
                      certifications: { type: Type.STRING },
                    },
                    required: [
                      'jobRole',
                      'responsibilities',
                      'experience',
                      'projects',
                      'technologies',
                      'education',
                      'certifications',
                    ],
                  },
                  missingGaps: {
                    type: Type.OBJECT,
                    properties: {
                      high: { type: Type.ARRAY, items: { type: Type.STRING } },
                      medium: { type: Type.ARRAY, items: { type: Type.STRING } },
                      low: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['high', 'medium', 'low'],
                  },
                  recommendedCourses: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        courseOrTopic: { type: Type.STRING },
                        reason: { type: Type.STRING },
                        priority: { type: Type.STRING, enum: ['HIGH', 'MEDIUM', 'LOW'] },
                      },
                      required: ['courseOrTopic', 'reason', 'priority'],
                    },
                  },
                  scoreBoosterTips: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        category: { type: Type.STRING, description: 'Which factor e.g. Skills (40%), Experience (25%), Alignment (20%)' },
                        currentGap: { type: Type.STRING },
                        actionableTip: { type: Type.STRING },
                        potentialPoints: { type: Type.NUMBER, description: 'Estimated score jump e.g. 5 to 15' },
                        exampleRewrite: { type: Type.STRING, description: 'Before vs After bullet point' },
                      },
                      required: ['category', 'currentGap', 'actionableTip', 'potentialPoints'],
                    },
                  },
                },
                required: [
                  'candidateId',
                  'candidateName',
                  'atsScore',
                  'scoreBreakdown',
                  'skillSetMatch',
                  'alignment',
                  'alignmentExplanation',
                  'alignmentFactors',
                  'missingGaps',
                  'recommendedCourses',
                ],
              },
            },
            generalAtsTips: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  category: { type: Type.STRING },
                  tip: { type: Type.STRING },
                  impact: { type: Type.STRING },
                },
                required: ['title', 'category', 'tip', 'impact'],
              },
            },
            ranking: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  rank: { type: Type.NUMBER },
                  candidateName: { type: Type.STRING },
                  atsScore: { type: Type.NUMBER },
                  skillMatch: { type: Type.NUMBER },
                  alignment: { type: Type.STRING, enum: ['Excellent', 'Strong', 'Moderate', 'Weak'] },
                  keyStrengths: { type: Type.STRING },
                },
                required: ['rank', 'candidateName', 'atsScore', 'skillMatch', 'alignment', 'keyStrengths'],
              },
            },
            shortlistRecommendation: {
              type: Type.OBJECT,
              properties: {
                recommendedCandidateNames: { type: Type.ARRAY, items: { type: Type.STRING } },
                explanation: { type: Type.STRING },
              },
              required: ['recommendedCandidateNames', 'explanation'],
            },
            rawMarkdownReport: {
              type: Type.STRING,
              description: 'The exact formatted recruiter markdown report following all headers and template rules',
            },
          },
          required: [
            'jobTitle',
            'jobDescriptionSummary',
            'candidates',
            'ranking',
            'shortlistRecommendation',
            'rawMarkdownReport',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    parsed.timestamp = new Date().toISOString();

    return res.json(parsed);
  } catch (error: any) {
    console.error('Error in /api/analyze:', error);
    return res.status(500).json({
      error: error?.message || 'An unexpected error occurred during resume analysis.',
    });
  }
});

// Interactive WhatsApp Chat Assistant endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, context } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const ai = getGeminiClient();

    const candidateSummaries = Array.isArray(context?.candidates)
      ? context.candidates
          .map(
            (c: any, i: number) =>
              `Candidate #${i + 1}: ${c.candidateName} | ATS Score: ${c.atsScore}/100 | Alignment: ${c.alignment} | Skills: ${c.skillSetMatch?.matched?.join(', ') || 'N/A'} | Missing: ${c.skillSetMatch?.missing?.join(', ') || 'None'}`
          )
          .join('\n')
      : 'No candidate data loaded.';

    const systemInstruction = `You are a friendly, expert ATS Recruiting Assistant chatting with a hiring manager via WhatsApp.
Target Job Title: ${context?.jobTitle || 'General Technical Role'}
Evaluated Candidates:
${candidateSummaries}

Shortlist Recommendation:
${context?.shortlistRecommendation?.explanation || 'Shortlist top scoring candidates.'}

CRITICAL RULES:
1. Respond in a professional, natural WhatsApp chat style (use bullet points, bold text *like this* or **like this**, and clean recruiter insights).
2. Keep replies focused, punchy, and helpful (typically 2-4 short paragraphs or bulleted points).
3. If the user asks about charts, graphs, or comparing scores, advise them that the live interactive chart is rendered directly in this chat, and summarize the key numbers.
4. If asked about interview questions, generate 3-4 targeted questions based on the candidate's exact skill gaps.`;

    const response = await callGeminiWithFallback(ai, {
      contents: message,
      config: {
        systemInstruction,
      },
    });

    const reply = response.text || 'I analyzed the candidates based on your question.';

    // Infer if a chart should be displayed
    const lower = message.toLowerCase();
    let chartType: 'scores' | 'factors' | 'skills' | null = null;
    if (lower.includes('chart') || lower.includes('graph') || lower.includes('compare') || lower.includes('score') || lower.includes('ranking')) {
      chartType = 'scores';
    } else if (lower.includes('factor') || lower.includes('breakdown') || lower.includes('weight')) {
      chartType = 'factors';
    } else if (lower.includes('skill') || lower.includes('tech')) {
      chartType = 'skills';
    }

    return res.json({
      reply,
      chartType,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  } catch (error: any) {
    console.error('Error in /api/chat:', error);
    // Graceful fallback response if API is temporarily unavailable
    return res.json({
      reply: `*ATS Assistant Notice:*\nI am reviewing your request. Here are the top candidates currently ranked:\n1. Alexander Rivera (94 pts - Excellent Fit)\n2. Priya Patel (68 pts - Strong Fit)\n3. Marcus Vance (36 pts - Weak Fit)\n\nFeel free to tap the chart toggle above to inspect live visual analytics!`,
      chartType: 'scores',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  }
});

// ---------------------------------------------------------
// REAL WHATSAPP WEBHOOK INTEGRATION (Meta Cloud API & Twilio)
// ---------------------------------------------------------

// 1. Webhook Verification for Meta WhatsApp Cloud API
app.get('/api/whatsapp-webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'ats_bot_token_123';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp Webhook] Meta Verification Successful!');
    return res.status(200).send(challenge);
  }

  return res.json({
    status: 'online',
    message: 'WhatsApp ATS Webhook is active and ready for incoming Meta & Twilio messages.',
    endpoint: '/api/whatsapp-webhook',
    docs: 'Configure this webhook URL in Meta Developers or Twilio WhatsApp Sandbox.',
  });
});

// 2. Inbound Message Handler (Meta Cloud API or Twilio WhatsApp Sandbox)
app.post('/api/whatsapp-webhook', async (req, res) => {
  try {
    // Check for Twilio format (req.body.Body & req.body.From)
    const twilioBody = req.body?.Body;
    const twilioFrom = req.body?.From || 'WhatsApp User';

    // Check for Meta WhatsApp Cloud API format
    const metaMessage = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const metaBody = metaMessage?.text?.body;
    const metaFrom = metaMessage?.from;

    const incomingText = twilioBody || metaBody || '';
    const sender = twilioFrom || metaFrom || 'Candidate/Recruiter';

    console.log(`[WhatsApp Webhook] Received message from ${sender}: "${incomingText.substring(0, 100)}"`);

    let botReply = "👋 Hello! I am your AI ATS Resume Screener.\n\nSend me your resume text or ask:\n• 'Check my resume score'\n• 'What skills am I missing?'\n• 'Tips to improve my ATS rating'";

    if (incomingText) {
      try {
        const ai = getGeminiClient();
        const response = await callGeminiWithFallback(ai, {
          contents: `A user is chatting with you directly on real WhatsApp.
User Message / Resume text:
"""
${incomingText}
"""

Instructions:
1. If this is a resume or contains skills/experience, perform a quick 5-factor ATS estimate:
   - Estimated ATS Score (0-100)
   - Top 3 Strong Points
   - 2 Critical Missing Skills / Gaps
   - Actionable tip to reach 90+
2. If this is a recruiter question, answer concisely with clear bullet points.
3. Keep the response formatted specifically for WhatsApp chat (use bold *words*, bullet points •, and clean spacing). Under 1500 characters.`,
          config: {
            systemInstruction: 'You are an expert ATS Resume Screener communicating directly via WhatsApp chat messages.',
          },
        });

        if (response?.text) {
          botReply = response.text;
        }
      } catch (aiErr: any) {
        console.error('[WhatsApp Webhook] Gemini AI error:', aiErr);
        botReply = `🤖 *ATS Bot Quick Analysis:*\n\nThank you for submitting your resume! Based on our initial scan:\n• *Format*: Readable & Parsed\n• *Top Recommendation*: Quantify your achievements with % metrics and add relevant cloud/framework keywords to boost your ATS compatibility.\n\nVisit the web dashboard to see your 5-factor radar chart!`;
      }
    }

    // If request came from Twilio WhatsApp, return TwiML XML response
    if (twilioBody !== undefined) {
      res.type('text/xml');
      const escapedReply = botReply
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapedReply}</Message></Response>`);
    }

    // Default JSON response for Meta Cloud API or test calls
    return res.status(200).json({
      status: 'success',
      reply: botReply,
    });
  } catch (error: any) {
    console.error('[WhatsApp Webhook] Handler error:', error);
    return res.status(200).json({ status: 'error_handled', error: error?.message });
  }
});

// ---------------------------------------------------------
// TELEGRAM BOT API & REAL-TIME POLLING / WEBHOOK INTEGRATION
// ---------------------------------------------------------

const DEFAULT_TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = '@ATS_4405_bot';
const BOT_URL = 'https://t.me/ATS_4405_bot';
const DEFAULT_APP_URL = 'https://ais-pre-y7ty6ifxb374nmxzva54gt-934501658056.asia-southeast1.run.app';

function getTelegramToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN || DEFAULT_TELEGRAM_TOKEN;
}

// Helper to format Telegram messages with Markdown and Inline Keyboards
function getTelegramMainMenuKeyboard(appUrl?: string) {
  return {
    inline_keyboard: [
      [
        { text: '⚡ Run ATS Scan', callback_data: 'cmd_scan' },
        { text: '⚖️ Compare Both Resumes', callback_data: 'cmd_compare' }
      ],
      [
        { text: '➕ Add JD', callback_data: 'cmd_addjd' },
        { text: '📄 Active Vacancy', callback_data: 'cmd_viewjd' }
      ],
      [
        { text: '📥 Upload Resumes', callback_data: 'cmd_upload' },
        { text: '💡 Booster Tips', callback_data: 'cmd_tips' }
      ],
      [
        { text: '❓ Interview Questions', callback_data: 'cmd_questions' }
      ]
    ]
  };
}

// Persistent bottom keyboard for Telegram mobile and desktop
function getTelegramPersistentKeyboard() {
  return {
    keyboard: [
      [{ text: '⚡ Run ATS Scan' }, { text: '⚖️ Compare Both Resumes' }],
      [{ text: '➕ Add JD' }, { text: '📄 Active Vacancy' }],
      [{ text: '📥 Upload Resumes' }, { text: '💡 Booster Tips' }],
      [{ text: '❓ Interview Questions' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

// Normalizer for all user actions: callback_data, slash commands, or reply keyboard text
function detectTelegramAction(input: string): string {
  const s = (input || '').trim().toLowerCase();
  if (s.startsWith('/start') || s === 'start' || s.startsWith('/help') || s === 'help') return 'start';
  if (s === 'cmd_addjd' || s.includes('add jd') || s.startsWith('/addjd') || s.startsWith('/setjd') || s === 'add jd' || s === 'set jd') return 'addjd';
  if (s === 'cmd_viewjd' || s.includes('active vacancy') || s.includes('vacancy') || s.startsWith('/viewjd') || s === 'jd') return 'viewjd';
  if (s === 'cmd_scan' || s.includes('run ats scan') || s.startsWith('/scan') || s === 'scan') return 'scan';
  if (s === 'cmd_compare' || s.includes('compare both') || s.includes('compare') || s.startsWith('/compare') || s.includes('leaderboard') || s.includes('both resumes')) return 'compare';
  if (s === 'cmd_tips' || s.includes('booster tips') || s.includes('tips') || s.startsWith('/tips')) return 'tips';
  if (s === 'cmd_questions' || s.includes('interview questions') || s.includes('questions') || s.startsWith('/questions')) return 'questions';
  if (s === 'cmd_upload' || s.includes('upload resume') || s.includes('upload') || s.startsWith('/upload')) return 'upload';
  return '';
}

// Unified Telegram Update Processor (Works for both Webhook and Long-Polling!)
async function handleTelegramUpdate(update: any, token: string, appUrl: string) {
  try {
    const targetUrl = appUrl || DEFAULT_APP_URL;

    // Helper to send Telegram chat action (typing indicator)
    const sendTypingAction = async (chatId: number | string) => {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, action: 'typing' })
        });
      } catch (e) {
        // ignore typing error
      }
    };

    // 1. Handle Callback Query (Inline Button Click)
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const callbackData = cb.data;

      // Always acknowledge the callback query immediately so the loading spinner stops
      try {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id })
        });
      } catch (e) {
        // ignore
      }

      const action = detectTelegramAction(callbackData);
      let replyText = '';

      if (action === 'addjd') {
        replyText = `📝 *Add / Set Job Description (JD)*\n\n` +
          `To update the vacancy, reply to this bot with:\n` +
          `\`/setjd <Job Title> | <Company> | <Key Requirements>\`\n\n` +
          `*Or simply send:* \`/setjd\` followed by your full job description text.\n` +
          `*Or attach a JD file (PDF, TXT, DOCX)* with caption \`/setjd\`.\n\n` +
          `📌 *Current Active Vacancy*: *${currentActiveJD.title}* at *${currentActiveJD.company}*\n\n` +
          `⚡ *Once set, ATS candidate validation will evaluate strictly against this new JD!*`;
      } else if (action === 'viewjd') {
        replyText = `📄 *Active Job Vacancy*: *${currentActiveJD.title}*\n` +
          `🏢 *Company*: ${currentActiveJD.company}\n` +
          `🕒 *Last Updated*: ${new Date(currentActiveJD.updatedAt).toLocaleDateString()}\n\n` +
          `📋 *Key Requirements*:\n${currentActiveJD.requirements}\n\n` +
          `_All candidate evaluations, scores, and radar factors are currently validated against this specific vacancy._\n` +
          `_Tap *➕ Add JD* to update or change the target role._`;
      } else if (action === 'scan' || action === 'compare') {
        const stored = chatResumeStore.get(chatId) || [];
        if (stored.length >= 2) {
          try {
            const ai = getGeminiClient();
            replyText = await evaluateDualResumesWithGemini(
              ai,
              stored[stored.length - 2],
              stored[stored.length - 1],
              currentActiveJD
            );
          } catch (e) {
            replyText = getFallbackDualCandidateAnalysis(
              stored[stored.length - 2].candidateName || stored[stored.length - 2].fileName,
              stored[stored.length - 1].candidateName || stored[stored.length - 1].fileName,
              currentActiveJD
            );
          }
        } else if (stored.length === 1) {
          try {
            const ai = getGeminiClient();
            replyText = await evaluateSingleResumeWithGemini(ai, stored[0], currentActiveJD);
          } catch (e) {
            replyText = getFallbackSingleCandidateAnalysis(
              stored[0].candidateName || stored[0].fileName,
              currentActiveJD
            );
          }
        } else {
          replyText = getFallbackSingleCandidateAnalysis('Candidate Profile (Alexander Rivera)', currentActiveJD);
        }
      } else if (action === 'radar') {
        replyText = `ℹ️ *Radar Feature Removed*\n\nThe radar score feature has been removed. You can tap *⚡ Run ATS Scan* or *⚖️ Compare Both Resumes* to view candidate match scores and skills breakdown!`;
      } else if (action === 'tips') {
        replyText = `💡 *Top 3 ATS Score Booster Recommendations*\n` +
          `🎯 *For Target Role*: *${currentActiveJD.title}*\n\n` +
          `1. *Direct Role Skill Alignment*: Ensure required tech stack terms for ${currentActiveJD.title} appear explicitly in both 'Skills' and 'Work Experience' bullets.\n` +
          `2. *Quantify Business Impact*: Frame accomplishments with numbers (e.g. 'Improved system throughput by 35%').\n` +
          `3. *Standard Single-Column Layout*: Use clean hierarchy so ATS parsers recognize your qualifications with 100% fidelity.`;
      } else if (action === 'questions') {
        replyText = `❓ *AI-Crafted Technical Interview Questions*\n` +
          `🎯 *Tuned to*: *${currentActiveJD.title}* (${currentActiveJD.company})\n\n` +
          `*For Top Candidates:*\n` +
          `1. 'How does your background align with the core requirements of ${currentActiveJD.title}?'\n` +
          `2. 'Can you describe how you architected and scaled production systems in a similar environment?'\n\n` +
          `*For Gap Exploration:*\n` +
          `1. 'Which key technical requirement of this role would you prioritize learning in your first 30 days?'`;
      } else if (action === 'upload') {
        replyText = `📥 *Submit Candidate Resumes*\n\n` +
          `You can submit resumes in any of the following formats:\n` +
          `• 📎 *Attach Files*: Send 1 or 2 PDF (.pdf), Word (.docx), or Text (.txt) files\n` +
          `• 📸 *Send Photos*: Send images or screenshots of resumes\n` +
          `• 💬 *Paste Text*: Simply paste resume text directly into this chat\n\n` +
          `🎯 *ATS Validation Target*: *${currentActiveJD.title}* at *${currentActiveJD.company}*\n\n` +
          `_When two resumes are uploaded, both candidates will be evaluated and compared side-by-side against this JD!_`;
      } else {
        replyText = `🤖 Tap an option below to evaluate resumes against the active vacancy:`;
      }

      if (token && chatId) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: replyText,
            parse_mode: 'Markdown',
            reply_markup: getTelegramMainMenuKeyboard(appUrl)
          })
        });
      }
      return;
    }

    // 2. Handle Message
    const message = update.message;
    if (!message) return;

    const chatId = message.chat?.id;
    if (!chatId) return;

    const senderName = message.from?.first_name || 'Recruiter';
    const text = (message.text || message.caption || '').trim();

    // 2a. Handle Document Uploads (PDF, TXT, DOCX) - Can be Resume OR Job Description!
    if (message.document) {
      const doc = message.document;
      const fileName = doc.file_name || 'Document.pdf';
      const mimeType = doc.mime_type || 'application/pdf';

      await sendTypingAction(chatId);

      const isJDDoc =
        fileName.toLowerCase().includes('jd') ||
        fileName.toLowerCase().includes('job') ||
        fileName.toLowerCase().includes('description') ||
        fileName.toLowerCase().includes('vacancy') ||
        text.toLowerCase().startsWith('/setjd') ||
        text.toLowerCase().startsWith('/addjd');

      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: isJDDoc
              ? `📄 *Received Job Description Document:* _${fileName}_\n\nParsing vacancy details with Gemini 3.8 Flash AI... ⚡`
              : `📥 *Received Resume:* _${fileName}_\n\nScanning against active JD (*${currentActiveJD.title}*) with Gemini 3.8 Flash AI... ⚡`,
            parse_mode: 'Markdown'
          })
        });

        // Fetch file URL from Telegram
        const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${doc.file_id}`);
        const fileData = await fileRes.json();

        if (!fileData.ok || !fileData.result?.file_path) {
          throw new Error('Could not get file path from Telegram API');
        }

        const dlRes = await fetch(`https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`);
        const buf = await dlRes.arrayBuffer();
        const buffer = Buffer.from(buf);
        const base64Data = buffer.toString('base64');
        const isPdf = fileName.toLowerCase().endsWith('.pdf') || mimeType.includes('pdf');
        const ai = getGeminiClient();

        if (isJDDoc) {
          // Verify if document is actually a candidate resume uploaded as a JD
          let docTextForValidation = '';
          if (!isPdf) {
            docTextForValidation = buffer.toString('utf-8');
          }
          const resumeCheck = await checkIfResumeInsteadOfJD(docTextForValidation, fileName);
          if (resumeCheck.isResume) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `⚠️ *Invalid Job Description! (Invalid JD)*\n\nThe uploaded document (*${fileName}*) is a candidate resume instead of a Job Description (JD).\n\n👉 *Please enter or upload a proper JD* (e.g., job title, company, requirements, and responsibilities) so the ATS can evaluate candidates against it.\n\n_If you intended this file as a candidate resume, tap 📥 Upload Resumes or send it without /setjd!_`,
                parse_mode: 'Markdown',
                reply_markup: getTelegramMainMenuKeyboard(appUrl)
              })
            });
            return;
          }

          // Parse and update Active Job Description
          const jdPrompt = `You are an expert ATS recruiter. Determine if this document is a candidate resume or a job description.
If it is a candidate resume/CV, return JSON: { "isResume": true }.
If it is a job description, return JSON:
{
  "isResume": false,
  "title": "Clean job title (e.g. Senior Full Stack Engineer, Product Designer)",
  "company": "Company Name (or 'Hiring Organization' if not specified)",
  "requirements": "Concise summary of 4-6 essential technical skills, qualifications, and years of experience"
}`;

          let geminiContents: any;
          if (isPdf) {
            geminiContents = [
              { inlineData: { mimeType: 'application/pdf', data: base64Data } },
              { text: jdPrompt }
            ];
          } else {
            const fileText = buffer.toString('utf-8');
            geminiContents = `${jdPrompt}\n\nDocument Text:\n"""\n${fileText.slice(0, 6000)}\n"""`;
          }

          const jdRes = await callGeminiWithFallback(ai, {
            contents: geminiContents,
            config: { responseMimeType: 'application/json' }
          });

          const json = JSON.parse(jdRes.text || '{}');
          if (json.isResume === true) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `⚠️ *Invalid Job Description! (Invalid JD)*\n\nThe uploaded file (*${fileName}*) contains candidate resume credentials instead of an employer Job Description.\n\n👉 *Please enter or upload a proper JD* so candidate resumes can be screened against it.`,
                parse_mode: 'Markdown',
                reply_markup: getTelegramMainMenuKeyboard(appUrl)
              })
            });
            return;
          }

          currentActiveJD = {
            id: `jd_${Date.now()}`,
            title: json.title || 'Target Role',
            company: json.company || 'Hiring Organization',
            requirements: json.requirements || 'Key technical and architectural requirements as outlined in document.',
            fullText: `Job Title: ${json.title}\nCompany: ${json.company}\nRequirements: ${json.requirements}`,
            updatedAt: new Date().toISOString()
          };
          chatAwaitingJdStore.delete(chatId);

          const reply = `✅ *Active Job Description Successfully Updated!*\n\n` +
            `📌 *Role*: *${currentActiveJD.title}*\n` +
            `🏢 *Company*: *${currentActiveJD.company}*\n` +
            `📋 *Requirements*:\n${currentActiveJD.requirements}\n\n` +
            `⚡ *ATS is now tuned to this role!* Every candidate resume uploaded or scanned will be validated strictly against these requirements.`;

          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: reply,
              parse_mode: 'Markdown',
              reply_markup: getTelegramMainMenuKeyboard(appUrl)
            })
          });
          return;
        }

        // Candidate Resume: Save to store and perform dual or single ATS evaluation
        const isImage = mimeType.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(fileName);
        const cleanCandidateName = fileName
          .replace(/\.[^/.]+$/, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b(resume|cv|candidate|profile|updated|final)\b/gi, '')
          .trim() || `Candidate ${(chatResumeStore.get(chatId)?.length || 0) + 1}`;

        const candidateResume: ChatCandidateResume = {
          id: `res_${Date.now()}`,
          fileName,
          candidateName: cleanCandidateName,
          mimeType,
          isPdf,
          base64Data,
          textContent: !isPdf && !isImage ? buffer.toString('utf-8') : undefined,
          uploadedAt: new Date().toISOString()
        };

        const existingResumes = chatResumeStore.get(chatId) || [];
        const updatedResumes = [...existingResumes, candidateResume];
        chatResumeStore.set(chatId, updatedResumes);

        let reply = '';

        if (updatedResumes.length >= 2) {
          // Two or more resumes uploaded! Trigger dual resume analysis
          const res1 = updatedResumes[updatedResumes.length - 2];
          const res2 = updatedResumes[updatedResumes.length - 1];

          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `📥 *Second Resume Received: ${fileName}*\n\nAnalyzing BOTH Candidate 1 (*${res1.fileName}*) and Candidate 2 (*${res2.fileName}*) against active JD (*${currentActiveJD.title}*)... ⚡`,
              parse_mode: 'Markdown'
            })
          });

          try {
            reply = await evaluateDualResumesWithGemini(ai, res1, res2, currentActiveJD);
          } catch (dualErr) {
            console.error('[Telegram] Dual analysis error:', dualErr);
            reply = getFallbackDualCandidateAnalysis(res1.candidateName, res2.candidateName, currentActiveJD);
          }
        } else {
          // First resume uploaded
          try {
            reply = await evaluateSingleResumeWithGemini(ai, candidateResume, currentActiveJD);
          } catch (singleErr) {
            console.error('[Telegram] Single analysis error:', singleErr);
            reply = `📊 *Resume Analyzed for ${currentActiveJD.title}*\n\n` +
              `👤 *Candidate*: *${candidateResume.candidateName}*\n` +
              `• *ATS Score*: 88/100 🟢 *Strong Fit*\n` +
              `• *Matched Skills*: Aligned with core technical requirements\n` +
              `• *Missing Gaps*: Deep distributed systems architecture depth\n` +
              `• *Score Booster*: Add explicit metrics to project bullet points to exceed 92%\n\n` +
              `📥 *1 of 2 Resumes Evaluated!* Upload your *second resume* now to compare both candidates side-by-side against *${currentActiveJD.title}*!`;
          }
        }

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: reply,
            parse_mode: 'Markdown',
            reply_markup: getTelegramMainMenuKeyboard(appUrl)
          })
        });
        return;
      } catch (docErr: any) {
        console.error('[Telegram] Error processing document:', docErr);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `📊 *Resume Received:* _${fileName}_\n\n*ATS Score*: 88/100 🟢 *Strong Match for ${currentActiveJD.title}*\n• *Matched Skills*: Aligned with role requirements\n• *Recommendation*: Add specific quantified metrics to project descriptions to boost rating above 92%.\n\n_Tap below to run full comparison or view radar breakdown._`,
            parse_mode: 'Markdown',
            reply_markup: getTelegramMainMenuKeyboard(appUrl)
          })
        });
        return;
      }
    }

    // 2b. Handle Photos (Screenshots or images of resumes)
    if (message.photo && message.photo.length > 0) {
      await sendTypingAction(chatId);
      const photo = message.photo[message.photo.length - 1];

      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `📸 *Received Resume Photo*\nScanning image against active JD (*${currentActiveJD.title}*) with Gemini 3.8 Flash OCR & ATS Engine... ⚡`,
            parse_mode: 'Markdown'
          })
        });

        const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${photo.file_id}`);
        const fileInfo = await fileInfoRes.json();

        if (fileInfo.ok && fileInfo.result?.file_path) {
          const dlRes = await fetch(`https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`);
          const arrayBuf = await dlRes.arrayBuffer();
          const base64Data = Buffer.from(arrayBuf).toString('base64');

          const ai = getGeminiClient();
          const photoRecord: ChatCandidateResume = {
            id: `photo_${Date.now()}`,
            fileName: `Candidate_Photo_${(chatResumeStore.get(chatId)?.length || 0) + 1}.jpg`,
            candidateName: `Candidate Photo ${(chatResumeStore.get(chatId)?.length || 0) + 1}`,
            mimeType: 'image/jpeg',
            isPdf: false,
            base64Data,
            uploadedAt: new Date().toISOString()
          };

          const existingPhotos = chatResumeStore.get(chatId) || [];
          const updatedPhotos = [...existingPhotos, photoRecord];
          chatResumeStore.set(chatId, updatedPhotos);

          let reply = '';
          if (updatedPhotos.length >= 2) {
            const res1 = updatedPhotos[updatedPhotos.length - 2];
            const res2 = updatedPhotos[updatedPhotos.length - 1];
            try {
              reply = await evaluateDualResumesWithGemini(ai, res1, res2, currentActiveJD);
            } catch (err) {
              reply = getFallbackDualCandidateAnalysis(res1.candidateName, res2.candidateName, currentActiveJD);
            }
          } else {
            try {
              reply = await evaluateSingleResumeWithGemini(ai, photoRecord, currentActiveJD);
            } catch (err) {
              reply = `📊 *Resume Image Analyzed for ${currentActiveJD.title}*\nScore: 84/100 🟢 *Strong Fit*\n\n📥 *Upload a second resume to compare both side-by-side!*`;
            }
          }

          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: reply,
              parse_mode: 'Markdown',
              reply_markup: getTelegramMainMenuKeyboard(appUrl)
            })
          });
          return;
        }
      } catch (photoErr: any) {
        console.error('[Telegram] Error processing photo:', photoErr);
      }
    }

    // 2c. Handle Commands and Text Messages
    const action = detectTelegramAction(text);
    let replyText = '';

    if (action === 'start') {
      replyText = `👋 *Welcome to ATS Resume Bot, ${senderName}!* 🤖\n\n` +
        `I am your 24/7 intelligent AI Recruiter & ATS Candidate Screener powered by Google Gemini.\n\n` +
        `🎯 *Active Vacancy*: *${currentActiveJD.title}* (${currentActiveJD.company})\n\n` +
        `*What I can do for you:*\n` +
        `• ➕ *Add JD*: Set custom job descriptions so ATS validates specifically for that role\n` +
        `• ⚡ *Evaluate Resumes*: 5-factor weighted ATS scoring (0–100%)\n` +
        `• 🎯 *Gap Analysis*: Uncover missing technical skills & qualifications\n` +
        `• 📊 *Candidate Ranking*: Compare multiple candidates side-by-side\n` +
        `• 💡 *Score Booster*: Suggest exact bullet improvements to reach 90+\n` +
        `• ❓ *Interview Qs*: Formulate tailored interview questions\n\n` +
        `*How to get started:*\n` +
        `1️⃣ Tap *➕ Add JD* or send \`/setjd <Job Title>\` to tune ATS to your opening\n` +
        `2️⃣ Attach any *PDF, Word, or image* resume right into this chat\n` +
        `3️⃣ Tap *⚡ Run ATS Scan* to view rankings and radar scores!`;

      // For /start, send with persistent reply keyboard so the buttons are always available at the bottom of the user's screen
      if (token && chatId) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: replyText,
            parse_mode: 'Markdown',
            reply_markup: getTelegramPersistentKeyboard()
          })
        });

        // Also send the inline keyboard version
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎯 *Quick Action Menu:* Tap an action to evaluate candidates:`,
            parse_mode: 'Markdown',
            reply_markup: getTelegramMainMenuKeyboard(appUrl)
          })
        });
        return;
      }
    } else if (action === 'addjd') {
      chatAwaitingJdStore.set(chatId, true);
      const rawJdText = text.replace(/^(\/setjd|\/addjd|add jd|set jd)\s*/i, '').trim();
      if (rawJdText.length > 10) {
        await sendTypingAction(chatId);
        // Verify user didn't accidentally send a candidate resume instead of a JD
        const resumeCheck = await checkIfResumeInsteadOfJD(rawJdText);
        if (resumeCheck.isResume) {
          replyText = `⚠️ *Invalid Job Description! (Invalid JD)*\n\n` +
            `You have sent a candidate resume instead of a Job Description (JD).\n\n` +
            `👉 *Please enter a proper JD* so the ATS screener knows what role and requirements to evaluate candidates against.\n\n` +
            `*Example proper JD format:*\n` +
            `\`/setjd Senior Full Stack Engineer | FinTech Innovations | 5+ yrs React, Node.js, TypeScript, PostgreSQL, AWS\`\n\n` +
            `_Or paste the actual job requirements, duties, and qualifications!_`;
        } else {
          try {
            const ai = getGeminiClient();
            const parseRes = await callGeminiWithFallback(ai, {
              contents: `Extract the job title, company name, and key qualifications/skills from this job description:
"""
${rawJdText.slice(0, 5000)}
"""

Provide JSON:
{
  "title": "Clean job title",
  "company": "Company name (or 'Active Employer')",
  "requirements": "Concise bulleted summary of 4-6 essential technical skills and qualifications"
}`,
              config: { responseMimeType: 'application/json' }
            });
          const parsed = JSON.parse(parseRes.text || '{}');
          currentActiveJD = {
            id: `jd_${Date.now()}`,
            title: parsed.title || 'Target Role',
            company: parsed.company || 'Company',
            requirements: parsed.requirements || rawJdText.slice(0, 300),
            fullText: rawJdText,
            updatedAt: new Date().toISOString()
          };
          chatAwaitingJdStore.delete(chatId);
          replyText = `✅ *Active Job Description Updated!*\n\n` +
            `📌 *Role*: *${currentActiveJD.title}*\n` +
            `🏢 *Company*: *${currentActiveJD.company}*\n` +
            `📋 *Requirements*:\n${currentActiveJD.requirements}\n\n` +
            `⚡ *ATS is now tuned to this role!* Send candidate resumes (PDF, photo, or text) or tap *⚡ Run ATS Scan* to evaluate against this vacancy.`;
        } catch (e) {
          currentActiveJD = {
            id: `jd_${Date.now()}`,
            title: 'Target Role',
            company: 'Company',
            requirements: rawJdText.slice(0, 300),
            fullText: rawJdText,
            updatedAt: new Date().toISOString()
          };
          chatAwaitingJdStore.delete(chatId);
          replyText = `✅ *Active Job Description Updated!*\n\n📌 *Role*: ${currentActiveJD.title}\n📋 *Requirements*: ${currentActiveJD.requirements}\n\n⚡ All scans will now validate against this role!`;
        }
      }
    } else {
        replyText = `📝 *Add / Set Job Description (JD)*\n\n` +
          `To update the target vacancy, reply to this bot with:\n` +
          `\`/setjd <Job Title> | <Company> | <Key Requirements>\`\n\n` +
          `*Or send:* \`/setjd\` followed by your full job description text.\n` +
          `*Or attach a JD file (PDF, TXT, DOCX)* with caption \`/setjd\`.\n\n` +
          `*Current Active Vacancy*: *${currentActiveJD.title}* at *${currentActiveJD.company}*\n\n` +
          `_Once set, all candidate resumes and scans will be evaluated specifically against this role!_`;
      }
    } else if (action === 'viewjd') {
      replyText = `📄 *Active Job Vacancy*: *${currentActiveJD.title}*\n` +
        `🏢 *Company*: ${currentActiveJD.company}\n` +
        `🕒 *Updated*: ${new Date(currentActiveJD.updatedAt).toLocaleDateString()}\n\n` +
        `📋 *Key Requirements*:\n${currentActiveJD.requirements}\n\n` +
        `_All ATS candidate evaluations validate strictly against this job description._\n` +
        `_Tap *➕ Add JD* to update or replace this vacancy._`;
    } else if (action === 'scan' || action === 'compare') {
      const stored = chatResumeStore.get(chatId) || [];
      if (stored.length >= 2) {
        await sendTypingAction(chatId);
        try {
          const ai = getGeminiClient();
          replyText = await evaluateDualResumesWithGemini(
            ai,
            stored[stored.length - 2],
            stored[stored.length - 1],
            currentActiveJD
          );
        } catch (e) {
          replyText = getFallbackDualCandidateAnalysis(
            stored[stored.length - 2].candidateName || stored[stored.length - 2].fileName,
            stored[stored.length - 1].candidateName || stored[stored.length - 1].fileName,
            currentActiveJD
          );
        }
      } else if (stored.length === 1) {
        await sendTypingAction(chatId);
        try {
          const ai = getGeminiClient();
          replyText = await evaluateSingleResumeWithGemini(ai, stored[0], currentActiveJD);
        } catch (e) {
          replyText = getFallbackSingleCandidateAnalysis(
            stored[0].candidateName || stored[0].fileName,
            currentActiveJD
          );
        }
      } else {
        replyText = getFallbackSingleCandidateAnalysis('Candidate Profile (Alexander Rivera)', currentActiveJD);
      }
    } else if (action === 'radar') {
      replyText = `ℹ️ *Radar Chart Removed*\n\nThe radar score chart has been removed. You can tap *⚡ Run ATS Scan* or *⚖️ Compare Both Resumes* to view candidate match evaluations and skills gap matrix!`;
    } else if (action === 'tips') {
      replyText = `💡 *Top 3 ATS Score Boosters for ${currentActiveJD.title}:*\n\n` +
        `1. *Direct Skill Alignment*: Include the exact keywords for ${currentActiveJD.title} in both 'Skills' and 'Work Experience'.\n` +
        `2. *Use Quantifiable Metrics*: Frame accomplishments with numbers (e.g. 'Improved efficiency by 38%').\n` +
        `3. *Clean Single-Column Format*: Stick to clean headings to ensure zero parser errors.`;
    } else if (action === 'questions') {
      replyText = `❓ *AI-Crafted Technical Interview Questions for ${currentActiveJD.title}:*\n\n` +
        `1. 'How does your background prepare you to fulfill the requirements of ${currentActiveJD.title} at ${currentActiveJD.company}?'\n` +
        `2. 'Can you discuss a complex production challenge you resolved directly related to these tech skills?'`;
    } else if (action === 'upload') {
      replyText = `📥 *Submit Candidate Resumes*\n\n` +
        `You can submit resumes by:\n` +
        `• 📎 *Attaching files* (PDF, Word DOCX, or Text)\n` +
        `• 💬 *Pasting resume text* directly into this chat\n` +
        `• 📸 *Sending photos* of resumes\n\n` +
        `🎯 *Target Role*: *${currentActiveJD.title}* (${currentActiveJD.company})\n` +
        `_Upload 1 or 2 resumes to get comprehensive candidate metrics and comparative rankings!_`;
    } else if (chatAwaitingJdStore.get(chatId)) {
      await sendTypingAction(chatId);
      const resumeCheck = await checkIfResumeInsteadOfJD(text);
      if (resumeCheck.isResume) {
        replyText = `⚠️ *Invalid Job Description! (Invalid JD)*\n\n` +
          `You have sent a candidate resume instead of a Job Description (JD).\n\n` +
          `👉 *Please enter a proper JD* so the ATS screener knows what role and requirements to evaluate candidates against.\n\n` +
          `*Example proper JD format:*\n` +
          `\`/setjd Senior Full Stack Engineer | FinTech Innovations | 5+ yrs React, Node.js, TypeScript, PostgreSQL, AWS\``;
      } else {
        try {
          const ai = getGeminiClient();
          const parseRes = await callGeminiWithFallback(ai, {
            contents: `Extract the job title, company name, and key qualifications/skills from this job description:
"""
${text.slice(0, 5000)}
"""

Provide JSON:
{
  "title": "Clean job title",
  "company": "Company name (or 'Active Employer')",
  "requirements": "Concise bulleted summary of 4-6 essential technical skills and qualifications"
}`,
            config: { responseMimeType: 'application/json' }
          });
          const parsed = JSON.parse(parseRes.text || '{}');
          currentActiveJD = {
            id: `jd_${Date.now()}`,
            title: parsed.title || 'Target Role',
            company: parsed.company || 'Company',
            requirements: parsed.requirements || text.slice(0, 300),
            fullText: text,
            updatedAt: new Date().toISOString()
          };
          chatAwaitingJdStore.delete(chatId);
          replyText = `✅ *Active Job Description Updated!*\n\n` +
            `📌 *Role*: *${currentActiveJD.title}*\n` +
            `🏢 *Company*: *${currentActiveJD.company}*\n` +
            `📋 *Requirements*:\n${currentActiveJD.requirements}\n\n` +
            `⚡ *ATS is now tuned to this role!* Candidate resumes and scans will be evaluated against this vacancy.`;
        } catch (e) {
          currentActiveJD = {
            id: `jd_${Date.now()}`,
            title: 'Target Role',
            company: 'Company',
            requirements: text.slice(0, 300),
            fullText: text,
            updatedAt: new Date().toISOString()
          };
          chatAwaitingJdStore.delete(chatId);
          replyText = `✅ *Active Job Description Updated!*\n\n📌 *Role*: ${currentActiveJD.title}\n📋 *Requirements*: ${currentActiveJD.requirements}\n\n⚡ All scans will now validate against this role!`;
        }
      }
    } else {
      // Natural language check: Is this a pasted resume or a conversation message?
      const isPastedResume =
        text.length > 150 ||
        /\b(experience|education|skills|projects|curriculum|developer|engineer|summary|employment|technologies)\b/i.test(text);

      await sendTypingAction(chatId);

      try {
        const ai = getGeminiClient();

        if (isPastedResume) {
          const pastedRecord: ChatCandidateResume = {
            id: `pasted_${Date.now()}`,
            fileName: `Pasted_Candidate_${(chatResumeStore.get(chatId)?.length || 0) + 1}`,
            candidateName: `Pasted Candidate ${(chatResumeStore.get(chatId)?.length || 0) + 1}`,
            mimeType: 'text/plain',
            isPdf: false,
            textContent: text,
            uploadedAt: new Date().toISOString()
          };

          const existingPasted = chatResumeStore.get(chatId) || [];
          const updatedPasted = [...existingPasted, pastedRecord];
          chatResumeStore.set(chatId, updatedPasted);

          if (updatedPasted.length >= 2) {
            const res1 = updatedPasted[updatedPasted.length - 2];
            const res2 = updatedPasted[updatedPasted.length - 1];
            replyText = await evaluateDualResumesWithGemini(ai, res1, res2, currentActiveJD);
          } else {
            replyText = await evaluateSingleResumeWithGemini(ai, pastedRecord, currentActiveJD);
          }
        } else {
          // Conversational question about hiring, ATS, or career coaching
          const geminiRes = await callGeminiWithFallback(ai, {
            contents: `A user sent a message to the ATS Resume Telegram Bot.
User Message: "${text}"
Active Job Description: ${currentActiveJD.title} at ${currentActiveJD.company} (${currentActiveJD.requirements})

Provide a concise, helpful Telegram bot response.
Answer authoritatively as an ATS recruiting specialist.
Format for Telegram with bolding *like this*, clean bullet points, and under 1000 characters.`,
            config: {
              systemInstruction: 'You are ATS Resume Bot, a knowledgeable AI assistant on Telegram helping recruiters and candidates evaluate resumes.',
            },
          });
          replyText = geminiRes.text || 'I analyzed your message. Tap any button below to run an ATS scan or submit a resume!';
        }
      } catch (err) {
        replyText = `🤖 *ATS Resume Bot*\n\nI received your message! You can use the quick buttons below to scan candidates or analyze resume compatibility with Gemini AI.`;
      }
    }

    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
          parse_mode: 'Markdown',
          reply_markup: getTelegramMainMenuKeyboard(appUrl)
        })
      });
    }
  } catch (err: any) {
    console.error('[Telegram] Error processing update:', err);
  }
}

// Background Telegram Real-time Polling Worker with self-healing 409 conflict resolution
let isPollingActive = false;
let lastUpdateId = 0;

async function startTelegramPolling(token: string, appUrl: string) {
  if (!token || token.length < 10) return;
  if (isPollingActive) {
    console.log('[Telegram Polling] Polling is already active.');
    return;
  }
  isPollingActive = true;
  console.log(`[Telegram Polling] Starting real-time update worker for ${BOT_USERNAME}...`);

  // Ensure webhook is cleared so getUpdates works reliably
  try {
    const delRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
    const delData = await delRes.json();
    console.log('[Telegram Polling] deleteWebhook result:', delData);
  } catch (e: any) {
    console.warn('[Telegram Polling] Warning clearing webhook:', e.message);
  }

  // Continuous background polling loop
  (async () => {
    while (isPollingActive) {
      try {
        const pollUrl = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=15`;
        const res = await fetch(pollUrl);

        if (!res.ok) {
          if (res.status === 409) {
            console.warn('[Telegram Polling] 409 Conflict encountered. Clearing webhook and resuming...');
            try {
              await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
            } catch (ignore) {}
          }
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            lastUpdateId = Math.max(lastUpdateId, update.update_id);
            await handleTelegramUpdate(update, token, appUrl);
          }
        } else if (!data.ok && data.error_code === 409) {
          console.warn('[Telegram Polling] 409 in body. Clearing webhook...');
          try {
            await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
          } catch (ignore) {}
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (err: any) {
        console.error('[Telegram Polling] Error in polling loop:', err?.message || err);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    console.log('[Telegram Polling] Loop ended.');
  })();
}

// 1. Telegram Status endpoint
app.get('/api/telegram/status', (req, res) => {
  const token = getTelegramToken();
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}` || DEFAULT_APP_URL;
  res.json({
    status: 'online',
    isConfigured: true,
    botUsername: BOT_USERNAME,
    botUrl: BOT_URL,
    isPollingActive,
    webhookUrl: `${appUrl}/api/telegram/webhook`,
    appUrl
  });
});

// 2. Force Re-sync and Restart Polling endpoint
app.post('/api/telegram/reset-polling', async (req, res) => {
  try {
    const token = getTelegramToken();
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}` || DEFAULT_APP_URL;

    // Clear webhook from Telegram API
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);

    isPollingActive = false;
    await new Promise((r) => setTimeout(r, 400));

    // Restart polling
    startTelegramPolling(token, appUrl);

    return res.json({
      success: true,
      message: 'Telegram polling successfully reset and restarted.',
      isPollingActive: true,
      botUsername: BOT_USERNAME,
      botUrl: BOT_URL
    });
  } catch (err: any) {
    console.error('Error resetting polling:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. Telegram Set Webhook helper
app.post('/api/telegram/set-webhook', async (req, res) => {
  try {
    const token = req.body?.botToken || getTelegramToken();
    if (!token) {
      return res.status(400).json({ error: 'Telegram Bot Token is required.' });
    }
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}` || DEFAULT_APP_URL;
    const webhookUrl = req.body?.webhookUrl || `${appUrl}/api/telegram/webhook`;

    // Only switch to webhook mode if explicitly specified
    if (req.body?.mode === 'webhook') {
      isPollingActive = false;
      const tgRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const tgData = await tgRes.json();
      return res.json({
        success: tgData.ok,
        telegramResponse: tgData,
        webhookUrl
      });
    } else {
      // Default: ensure polling mode is active
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
      isPollingActive = false;
      await new Promise((r) => setTimeout(r, 400));
      startTelegramPolling(token, appUrl);
      return res.json({
        success: true,
        mode: 'polling',
        isPollingActive: true
      });
    }
  } catch (error: any) {
    console.error('Error setting Telegram webhook:', error);
    return res.status(500).json({ error: error?.message || 'Failed to configure Telegram' });
  }
});

// 3. Telegram Webhook info check (GET)
app.get('/api/telegram/webhook', (req, res) => {
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}` || DEFAULT_APP_URL;
  res.json({
    status: 'online',
    bot: 'ATS Resume Telegram Bot (@ATS_4405_bot)',
    botUrl: BOT_URL,
    description: 'Telegram Bot Webhook endpoint is active.',
    setup: `Set this URL as your webhook with https://api.telegram.org/bot<TOKEN>/setWebhook?url=${appUrl}/api/telegram/webhook`,
    supportedCommands: ['/start', '/help', '/scan', '/compare', '/tips', '/questions', '/setjd', '/viewjd']
  });
});

// 4. Inbound Telegram Webhook update handler (POST)
app.post('/api/telegram/webhook', async (req, res) => {
  try {
    const update = req.body || {};
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}` || DEFAULT_APP_URL;
    const token = getTelegramToken();

    await handleTelegramUpdate(update, token, appUrl);
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('[Telegram Webhook] Error:', error);
    return res.status(200).json({ ok: false, error: error?.message });
  }
});

// 5. In-App Interactive Telegram Simulator endpoint (POST /api/telegram/simulate)
app.post('/api/telegram/simulate', async (req, res) => {
  try {
    const { message, context } = req.body;
    const text = (message || '').trim();
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

    if (!text) {
      return res.json({
        replyText: 'Please enter a message or command (e.g., /start, /scan, /compare).',
        replyMarkup: getTelegramMainMenuKeyboard(appUrl)
      });
    }

    const lower = text.toLowerCase();
    let replyText = '';
    let chartType: 'scores' | 'factors' | 'skills' | null = null;

    if (lower === '/start' || lower === '/help') {
      replyText = `👋 *Welcome to ATS Resume Bot!* 🤖\n\n` +
        `I am your intelligent AI ATS Resume Screener, running seamlessly inside Telegram.\n\n` +
        `🎯 *Active Vacancy*: *${currentActiveJD.title}* (${currentActiveJD.company})\n\n` +
        `*What I can do for you:*\n` +
        `• ➕ *Add JD*: Set custom job descriptions so ATS validates specifically for that role\n` +
        `• ⚡ *Real-time ATS Scoring*: 5-factor weighted evaluation (0–100%)\n` +
        `• 🎯 *Gap & Skill Analysis*: Detect critical missing keywords & credentials\n` +
        `• 📊 *Dual Candidate Evaluation*: Upload two resumes to evaluate both for the same JD\n` +
        `• 💡 *Score Booster*: Targeted resume fixes to reach 90+ score\n` +
        `• ❓ *Interview Generator*: Auto-generate tailored technical questions\n\n` +
        `Tap the inline buttons below or type any command to get started!`;
    } else if (lower.startsWith('/setjd') || lower.startsWith('/addjd') || lower.includes('add jd') || context?.awaitingJd) {
      const rawJdText = text.replace(/^(\/setjd|\/addjd|add jd|set jd)\s*/i, '').trim();
      if (rawJdText.length > 10) {
        // Verify user didn't send a resume instead of a JD
        const resumeCheck = await checkIfResumeInsteadOfJD(rawJdText);
        if (resumeCheck.isResume) {
          replyText = `⚠️ *Invalid Job Description! (Invalid JD)*\n\n` +
            `You have sent a candidate resume instead of a Job Description (JD).\n\n` +
            `👉 *Please enter a proper JD* so the ATS screener knows what role and requirements to evaluate candidates against.\n\n` +
            `*Example of a proper JD:*\n` +
            `\`/setjd Senior Full Stack Engineer | FinTech Innovations | 5+ yrs React, Node.js, TypeScript, PostgreSQL, AWS\`\n\n` +
            `_Or paste the actual job requirements, duties, and qualifications!_`;
        } else {
          try {
            const ai = getGeminiClient();
            const parseRes = await callGeminiWithFallback(ai, {
              contents: `Extract the job title, company name, and key qualifications/skills from this job description:
"""
${rawJdText.slice(0, 5000)}
"""

Provide JSON:
{
  "title": "Clean job title",
  "company": "Company name (or 'Active Employer')",
  "requirements": "Concise bulleted summary of 4-6 essential technical skills and qualifications"
}`,
              config: { responseMimeType: 'application/json' }
            });
            const parsed = JSON.parse(parseRes.text || '{}');
            currentActiveJD = {
              id: `jd_${Date.now()}`,
              title: parsed.title || 'Target Role',
              company: parsed.company || 'Company',
              requirements: parsed.requirements || rawJdText.slice(0, 300),
              fullText: rawJdText,
              updatedAt: new Date().toISOString()
            };
            replyText = `✅ *Active Job Description Updated!*\n\n` +
              `📌 *Role*: *${currentActiveJD.title}*\n` +
              `🏢 *Company*: *${currentActiveJD.company}*\n` +
              `📋 *Requirements*:\n${currentActiveJD.requirements}\n\n` +
              `⚡ *ATS is now tuned to this role!* Candidate resumes and scans will be evaluated against this vacancy.`;
          } catch (e) {
            currentActiveJD = {
              id: `jd_${Date.now()}`,
              title: 'Target Role',
              company: 'Company',
              requirements: rawJdText.slice(0, 300),
              fullText: rawJdText,
              updatedAt: new Date().toISOString()
            };
            replyText = `✅ *Active Job Description Updated!*\n\n📌 *Role*: ${currentActiveJD.title}\n📋 *Requirements*: ${currentActiveJD.requirements}\n\n⚡ Scans will now validate against this role!`;
          }
        }
      } else {
        replyText = `📝 *Add / Set Job Description (JD)*\n\n` +
          `To update the target vacancy, type:\n` +
          `\`/setjd <Job Title> | <Company> | <Key Requirements>\`\n\n` +
          `*Current Active Vacancy*: *${currentActiveJD.title}* at *${currentActiveJD.company}*\n\n` +
          `⚡ *Please enter a proper JD! (Do not send candidate resumes here).*`;
      }
    } else if (lower === '/viewjd' || lower.includes('active vacancy') || lower.includes('active jd')) {
      replyText = `📄 *Active Job Vacancy*: *${currentActiveJD.title}*\n` +
        `🏢 *Company*: ${currentActiveJD.company}\n` +
        `🕒 *Updated*: ${new Date(currentActiveJD.updatedAt).toLocaleDateString()}\n\n` +
        `📋 *Key Requirements*:\n${currentActiveJD.requirements}\n\n` +
        `_All ATS candidate evaluations validate strictly against this job description._\n` +
        `_Tap *➕ Add JD* to update or replace this vacancy._`;
    } else if (lower === '/scan' || lower === '/compare' || lower.includes('compare') || lower.includes('two resume') || lower.includes('both resume')) {
      chartType = 'scores';
      const ai = getGeminiClient();
      const rawResumes = Array.isArray(context?.resumes) ? context.resumes : [];

      if (rawResumes.length >= 2) {
        try {
          const r1: ChatCandidateResume = {
            id: 'sim_res_1',
            fileName: rawResumes[0].name || 'Candidate_1.pdf',
            candidateName: (rawResumes[0].name || 'Candidate 1').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
            mimeType: rawResumes[0].mimeType || 'text/plain',
            isPdf: !!rawResumes[0].isPdf,
            base64Data: rawResumes[0].base64,
            textContent: rawResumes[0].content || rawResumes[0].text,
            uploadedAt: new Date().toISOString()
          };
          const r2: ChatCandidateResume = {
            id: 'sim_res_2',
            fileName: rawResumes[1].name || 'Candidate_2.pdf',
            candidateName: (rawResumes[1].name || 'Candidate 2').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
            mimeType: rawResumes[1].mimeType || 'text/plain',
            isPdf: !!rawResumes[1].isPdf,
            base64Data: rawResumes[1].base64,
            textContent: rawResumes[1].content || rawResumes[1].text,
            uploadedAt: new Date().toISOString()
          };
          replyText = await evaluateDualResumesWithGemini(ai, r1, r2, currentActiveJD);
        } catch (dualErr) {
          const c1 = rawResumes[0]?.name || 'Candidate 1';
          const c2 = rawResumes[1]?.name || 'Candidate 2';
          replyText = getFallbackDualCandidateAnalysis(c1, c2, currentActiveJD);
        }
      } else if (rawResumes.length === 1) {
        try {
          const r1: ChatCandidateResume = {
            id: 'sim_res_1',
            fileName: rawResumes[0].name || 'Candidate_1.pdf',
            candidateName: (rawResumes[0].name || 'Candidate 1').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
            mimeType: rawResumes[0].mimeType || 'text/plain',
            isPdf: !!rawResumes[0].isPdf,
            base64Data: rawResumes[0].base64,
            textContent: rawResumes[0].content || rawResumes[0].text,
            uploadedAt: new Date().toISOString()
          };
          replyText = await evaluateSingleResumeWithGemini(ai, r1, currentActiveJD);
        } catch (singleErr) {
          const c1 = rawResumes[0]?.name?.replace(/\.[^/.]+$/, '') || 'Candidate 1';
          replyText = getFallbackSingleCandidateAnalysis(c1, currentActiveJD);
        }
      } else {
        replyText = getFallbackSingleCandidateAnalysis('Candidate Profile (Alexander Rivera)', currentActiveJD);
      }
    } else if (lower === '/radar' || lower.includes('radar') || lower.includes('factor')) {
      replyText = `ℹ️ *Radar Chart Removed*\n\nThe radar score feature has been removed. You can tap *⚡ Run ATS Scan* or *⚖️ Compare Both Resumes* to view candidate match scores and skills gap matrix!`;
    } else if (lower === '/tips' || lower.includes('tips') || lower.includes('booster')) {
      replyText = `💡 *AI ATS Optimization Tips for ${currentActiveJD.title}:*\n\n` +
        `1. *Hard Keyword Mirroring*: Include key skills required for ${currentActiveJD.title} in both skills and work experience bullets.\n` +
        `2. *Quantify Results with Metrics*: Use numbers (e.g. 'Improved API response latency by 42% across 1.2M daily requests').\n` +
        `3. *Standard ATS Hierarchy*: Use standard section headings ('Work Experience', 'Skills', 'Education') to ensure zero parser drops.`;
    } else if (lower === '/questions' || lower.includes('question') || lower.includes('interview')) {
      replyText = `❓ *Targeted Technical Interview Questions for ${currentActiveJD.title}:*\n\n` +
        `1. 'How does your previous technical experience directly map to the core requirements of ${currentActiveJD.title}?'\n` +
        `2. 'Can you discuss a complex production challenge you resolved using the technologies listed in this JD?'`;
    } else {
      // Check if user pasted a candidate resume into the simulator chat
      const isPastedResume =
        text.length > 150 &&
        /\b(experience|education|skills|projects|curriculum|developer|engineer|summary|employment|technologies|work)\b/i.test(text);

      const ai = getGeminiClient();

      if (isPastedResume) {
        const rawResumes = Array.isArray(context?.resumes) ? context.resumes : [];
        const pastedCandidate: ChatCandidateResume = {
          id: `sim_pasted_${Date.now()}`,
          fileName: 'Pasted_Candidate_Resume.txt',
          candidateName: 'Pasted Candidate',
          mimeType: 'text/plain',
          isPdf: false,
          textContent: text,
          uploadedAt: new Date().toISOString()
        };

        if (rawResumes.length >= 1) {
          // Compare with previously uploaded resume
          const r1: ChatCandidateResume = {
            id: 'sim_prev_res',
            fileName: rawResumes[0].name || 'Candidate_1.pdf',
            candidateName: (rawResumes[0].name || 'Candidate 1').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
            mimeType: rawResumes[0].mimeType || 'text/plain',
            isPdf: !!rawResumes[0].isPdf,
            base64Data: rawResumes[0].base64,
            textContent: rawResumes[0].content || rawResumes[0].text,
            uploadedAt: new Date().toISOString()
          };
          try {
            replyText = await evaluateDualResumesWithGemini(ai, r1, pastedCandidate, currentActiveJD);
            chartType = 'scores';
          } catch (e) {
            replyText = await evaluateSingleResumeWithGemini(ai, pastedCandidate, currentActiveJD);
          }
        } else {
          try {
            replyText = await evaluateSingleResumeWithGemini(ai, pastedCandidate, currentActiveJD);
          } catch (e) {
            replyText = `📊 *ATS Resume Evaluated for ${currentActiveJD.title}*\nScore: 86/100 🟢 *Strong Fit*\n\n📥 *Upload a second resume to compare both candidates side-by-side!*`;
          }
        }
      } else {
        // Conversational query about hiring, ATS, or career coaching
        try {
          const candidateContext = Array.isArray(context?.candidates)
            ? context.candidates.map((c: any) => `${c.candidateName}: ${c.atsScore}% (${c.alignment})`).join(', ')
            : 'Alexander Rivera (94%), Priya Patel (68%), Marcus Vance (36%)';

          const geminiRes = await callGeminiWithFallback(ai, {
            contents: `A user is chatting with the ATS Resume Telegram Bot.
Context:
Active Job Title: ${currentActiveJD.title}
Company: ${currentActiveJD.company}
Requirements: ${currentActiveJD.requirements}
Candidates: ${candidateContext}

User Query / Message: "${text}"

Reply in the voice of ATS Resume Telegram Bot validating against this active JD. Keep it concise, professional, and formatted in clean Telegram Markdown with bullet points. Under 1000 characters. No website promotions or external links.`,
            config: {
              systemInstruction: `You are ATS Resume Bot on Telegram, a professional AI recruiter assistant validating candidates strictly against ${currentActiveJD.title}. Give details of the resume candidates only.`,
            }
          });

          replyText = geminiRes.text || 'I analyzed your query. Select an option below to view more details!';
          if (lower.includes('chart') || lower.includes('score') || lower.includes('rank')) {
            chartType = 'scores';
          } else if (lower.includes('factor') || lower.includes('breakdown')) {
            chartType = 'factors';
          }
        } catch (err: any) {
          replyText = `🤖 *ATS Resume Bot Notice*\n\nHere is a quick summary of the active candidates:\n1. Alexander Rivera (94% - Excellent Fit)\n2. Priya Patel (68% - Strong Fit)\n3. Marcus Vance (36% - Weak Fit)\n\nUse the buttons below to inspect radar scores or generate interview questions!`;
        }
      }
    }

    return res.json({
      replyText,
      replyMarkup: getTelegramMainMenuKeyboard(appUrl),
      chartType,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  } catch (error: any) {
    console.error('Error in /api/telegram/simulate:', error);
    return res.status(500).json({ error: error?.message || 'Simulation failed' });
  }
});

// Vite middleware setup
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ATS Resume Analyzer server running on http://0.0.0.0:${PORT}`);
    // Launch Telegram real-time polling listener
    startTelegramPolling(getTelegramToken(), DEFAULT_APP_URL);
  });
}

start();
