import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService,
    private authService: AuthService,
  ) {
    const clientID = config.get<string>('GOOGLE_CLIENT_ID', '');
    if (!clientID) {
      // Passport requires a valid clientID — use a placeholder so NestJS boots.
      // Google OAuth endpoints will return 401 until real credentials are set.
      super({ clientID: 'DISABLED', clientSecret: 'DISABLED', callbackURL: 'DISABLED', scope: [] });
      return;
    }
    super({
      clientID,
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET', ''),
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL', ''),
      scope: ['email', 'profile'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback) {
    const user = await this.authService.findOrCreateGoogleUser({
      googleId: profile.id,
      email: profile.emails?.[0].value ?? '',
      name: profile.displayName,
      avatarUrl: profile.photos?.[0].value,
    });
    done(null, user);
  }
}
