import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  const port = process.env.PORT ?? 3001;
  const host = process.env.HOST; // 未设置时沿用 Nest/Node 默认监听地址
  await (host ? app.listen(port, host) : app.listen(port));
  console.log(`warlords-1931-server listening on port ${port}${host ? ` (host ${host})` : ''}`);
}
bootstrap();
