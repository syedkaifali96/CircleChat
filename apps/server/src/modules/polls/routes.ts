import type { FastifyInstance } from 'fastify';
import { createPollSchema, pollVoteSchema } from '@circlechat/shared';
import type { Database } from '../../db/client';
import { validationFailed } from '../../errors';
import {
  closePoll,
  createPoll,
  listPolls,
  removeVote,
  votePoll,
} from './service';

/**
 * Poll routes (M11) — docs/API.md. Authorization rides the conversation:
 * `requireConversationAccess` answers non-members/removed members and deleted
 * Circles with the same generic 404 the rest of the API uses, and refuses
 * direct conversations for poll creation (polls are Circle-only).
 */
export async function pollRoutes(
  app: FastifyInstance,
  options: {
    db: Database;
    /** Change-notification publisher (M6 design) for `poll:updated`. */
    publish?: (event: string, payload: unknown) => void;
  },
): Promise<void> {
  const { db, publish } = options;

  app.post(
    '/v1/conversations/:id/polls',
    { config: { auth: true, rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = createPollSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationFailed();
      }
      const poll = await createPoll(db, {
        conversationId: id,
        callerId: request.authUser!.userId,
        question: parsed.data.question,
        options: parsed.data.options,
        closesAt: parsed.data.closesAt,
      });
      publish?.('poll:updated', { conversationId: id, pollId: poll.id });
      await reply.header('cache-control', 'no-store').code(201).send({ poll });
    },
  );

  app.get('/v1/conversations/:id/polls', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const polls = await listPolls(db, id, request.authUser!.userId);
    await reply.header('cache-control', 'no-store').send({ polls });
  });

  app.post(
    '/v1/polls/:pollId/vote',
    { config: { auth: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { pollId } = request.params as { pollId: string };
      const parsed = pollVoteSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationFailed();
      }
      const poll = await votePoll(db, {
        pollId,
        callerId: request.authUser!.userId,
        optionIndex: parsed.data.optionIndex,
      });
      publish?.('poll:updated', { conversationId: poll.conversationId, pollId: poll.id });
      await reply.header('cache-control', 'no-store').send({ poll });
    },
  );

  app.delete(
    '/v1/polls/:pollId/vote',
    { config: { auth: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { pollId } = request.params as { pollId: string };
      const poll = await removeVote(db, { pollId, callerId: request.authUser!.userId });
      publish?.('poll:updated', { conversationId: poll.conversationId, pollId: poll.id });
      await reply.header('cache-control', 'no-store').send({ poll });
    },
  );

  app.post(
    '/v1/polls/:pollId/close',
    { config: { auth: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { pollId } = request.params as { pollId: string };
      const poll = await closePoll(db, { pollId, callerId: request.authUser!.userId });
      publish?.('poll:updated', { conversationId: poll.conversationId, pollId: poll.id });
      await reply.header('cache-control', 'no-store').send({ poll });
    },
  );
}
