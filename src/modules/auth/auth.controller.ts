import { Controller, Get, Post, Req, Res, UseGuards, HttpCode } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import type { JwtPayload } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  // ── Google OAuth ─────────────────────────────────────────────────────────
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Passport redirects automatically
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as any;
    const token = this.authService.signToken(user);
    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:3001');
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  }

  // ── Guest session ────────────────────────────────────────────────────────
  @Post('guest')
  @HttpCode(201)
  async createGuest() {
    const user = await this.authService.createGuestUser();
    const token = this.authService.signToken(user);
    return { token, user: { id: user.id, isGuest: true } };
  }

  @Post('guest/logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async guestLogout(@CurrentUser() payload: JwtPayload) {
    if (payload.isGuest) {
      await this.authService.deleteGuestUser(payload.sub);
    }
    return { message: 'Session ended' };
  }

  // ── Current user ─────────────────────────────────────────────────────────
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() payload: JwtPayload) {
    return payload;
  }
}
