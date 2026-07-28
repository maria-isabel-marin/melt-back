import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  app.setGlobalPrefix('api');

  const allowedOrigins = [
    process.env.FRONTEND_URL ?? 'http://localhost:3001',
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Permite curl, Postman y solicitudes entre servidores.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3000);

  await app.listen(port);

  console.log(`MELT-BACK running on port ${port}`);
  console.log(
    `Uploads available at http://localhost:${port}/uploads/`,
  );
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start MELT-BACK:', error);
  process.exit(1);
});