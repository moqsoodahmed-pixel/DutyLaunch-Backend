import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  getCompanyContext,
  buildSystemPrompt,
  toGroqMessages,
  callGroq,
  deriveActions,
} from '../services/aiAssistantService.js';

/**
 * POST /api/ai/assistant
 * Body: { message: string, history?: [{ role: 'user'|'assistant', text: string }] }
 *
 * Grounds every reply in live DutyLaunch data (pricing, courses, education
 * programmes, documentation services, published jobs, FAQs) plus the
 * signed-in user's own profile, then asks Groq to answer. The endpoint sits
 * behind `protect`, so `req.user` is always the authenticated user.
 */
export const chatWithAssistant = asyncHandler(async (req, res) => {
  const { message, history = [] } = req.body;

  const companyContext = await getCompanyContext();
  const systemPrompt = buildSystemPrompt(companyContext, req.user.toPublic());
  const messages = toGroqMessages(systemPrompt, history, message);

  const reply = await callGroq(messages);
  const actions = deriveActions(message, reply);

  sendSuccess(res, { message: 'Assistant reply', data: { reply, actions } });
});
