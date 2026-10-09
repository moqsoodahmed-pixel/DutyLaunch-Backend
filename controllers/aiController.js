import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  getCompanyContext,
  buildSystemPrompt,
  toGroqMessages,
  callAssistant,
  deriveActions,
} from '../services/aiAssistantService.js';
import { aiStatus, aiConfigured } from '../services/careerIntelligence/aiClient.js';

/**
 * POST /api/ai/assistant
 * Body: { message: string, history?: [{ role: 'user'|'assistant', text: string }] }
 *
 * Grounds every reply in live DutyLaunch data (pricing, courses, education
 * programmes, documentation services, published jobs, FAQs) plus the
 * signed-in user's own profile. Uses the multi-provider router (Groq →
 * OpenAI → Grok → Mistral) for resilience when one provider is unavailable.
 */
export const chatWithAssistant = asyncHandler(async (req, res) => {
  const { message, history = [] } = req.body;

  const companyContext = await getCompanyContext();
  const systemPrompt = buildSystemPrompt(companyContext, req.user.toPublic());
  const messages = toGroqMessages(systemPrompt, history, message);

  const reply = await callAssistant(messages);
  const actions = deriveActions(message, reply);

  sendSuccess(res, { message: 'Assistant reply', data: { reply, actions } });
});

/**
 * GET /api/ai/status
 * Returns which AI providers are configured (never includes keys).
 * Useful for the admin dashboard to verify the AI setup.
 */
export const getAiStatus = asyncHandler(async (req, res) => {
  sendSuccess(res, {
    message: 'AI provider status',
    data: { ...aiStatus(), configured: aiConfigured() },
  });
});
