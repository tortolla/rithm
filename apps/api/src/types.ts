import type { TelegramUser } from './lib/telegramAuth.js';

declare module 'fastify' {
  interface FastifyRequest {
    appUser: {
      id: string;
      telegramId: number;
      firstName: string;
      timezone: string;
      onboardingCompleted: boolean;
      telegram: TelegramUser;
    };
  }
}
