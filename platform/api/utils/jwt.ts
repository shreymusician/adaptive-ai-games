import jwt from 'jsonwebtoken';

const JWT_EXPIRES_IN = '7d';

const getSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
};

export interface TokenPayload {
  userId: string;
}

export const signToken = (payload: TokenPayload): string =>
  jwt.sign(payload, getSecret(), { expiresIn: JWT_EXPIRES_IN });

export const verifyToken = (token: string): TokenPayload =>
  jwt.verify(token, getSecret()) as TokenPayload;
