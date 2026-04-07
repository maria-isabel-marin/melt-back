import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  isGuest: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async findOrCreateGoogleUser(profile: {
    googleId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }): Promise<User> {
    let user = await this.prisma.user.findUnique({ where: { googleId: profile.googleId } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          googleId: profile.googleId,
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          isGuest: false,
        },
      });
    }

    return user;
  }

  async createGuestUser(): Promise<User> {
    const guestId = `guest_${Date.now()}`;
    return this.prisma.user.create({
      data: {
        email: `${guestId}@guest.melt`,
        name: 'Guest',
        isGuest: true,
      },
    });
  }

  async deleteGuestUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.isGuest) {
      await this.prisma.user.delete({ where: { id: userId } });
    }
  }

  signToken(user: User): string {
    const payload: JwtPayload = { sub: user.id, email: user.email, isGuest: user.isGuest };
    return this.jwt.sign(payload);
  }
}
