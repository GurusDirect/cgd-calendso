import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";

import firstOrCreateUser from "./user";

/**
 * Takes a token, and returns a new token with updated
 * `accessToken` and `accessTokenExpires`. If an error occurs,
 * returns the old token and an error property
 */
/**
 * @param  {JWT} token
 */
const refreshAccessToken = async (token: JWT) => {
  try {
    if (Date.now() > token.refreshTokenExpired) throw Error;
    const details = {
      client_id: process.env.KEYCLOAK_CLIENT_ID,
      client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
      grant_type: ["refresh_token"],
      refresh_token: token.refreshToken,
    };
    const formBody: string[] = [];
    Object.entries(details).forEach(([key, value]: [string, any]) => {
      const encodedKey = encodeURIComponent(key);
      const encodedValue = encodeURIComponent(value);
      formBody.push(encodedKey + "=" + encodedValue);
    });
    const formData = formBody.join("&");
    const url = `${process.env.KEYCLOAK_BASE_URL}/token`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: formData,
    });
    const refreshedTokens = await response.json();
    if (!response.ok) throw refreshedTokens;
    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpired: Date.now() + (refreshedTokens.expires_in - 15) * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
      refreshTokenExpired: Date.now() + (refreshedTokens.refresh_expires_in - 15) * 1000,
    };
  } catch (error) {
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
};

// keycloak
export default NextAuth({
  providers: [
    {
      id: "cloud-gurus",
      name: "Cloud Gurus",
      type: "oauth",
      version: "2.0",
      params: { grant_type: "authorization_code" },
      scope: "email profile roles",
      accessTokenUrl: `${process.env.KEYCLOAK_BASE_URL}/token`,
      requestTokenUrl: `${process.env.KEYCLOAK_BASE_URL}/auth`,
      authorizationUrl: `${process.env.KEYCLOAK_BASE_URL}/auth`,
      clientId: process.env.KEYCLOAK_CLIENT_ID,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      profileUrl: `${process.env.KEYCLOAK_BASE_URL}/userinfo`,
      profile: (profile) => {
        return {
          ...profile,
          id: profile.sub,
        };
      },
      authorizationParams: {
        response_type: "code",
      },
    },
  ],
  session: {
    jwt: true,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
  callbacks: {
    /**
     * @param  {object} user     User object
     * @param  {object} account  Provider account
     * @param  {object} profile  Provider profile
     * @return {boolean|string}  Return `true` to allow sign in
     *                           Return `false` to deny access
     *                           Return `string` to redirect to (eg.: "/unauthorized")
     */
    async signIn(user, account) {
      if (account && user) {
        return true;
      } else {
        // TODO : Add unauthorized page
        return "/unauthorized";
      }
    },
    /**
     * @param  {string} url      URL provided as callback URL by the client
     * @param  {string} baseUrl  Default base URL of site (can be used as fallback)
     * @return {string}          URL the client will be redirect to
     */
    async redirect(url, baseUrl) {
      return url.startsWith(baseUrl) ? url : baseUrl;
    },
    /**
     * @param  {object} session      Session object
     * @param  {object} token        User object    (if using database sessions)
     *                               JSON Web Token (if not using database sessions)
     * @return {object}              Session that will be returned to the client
     */
    async session(session, token: JWT) {
      if (token) {
        session.user = token.user;
        session.error = token.error;
        session.accessToken = token.accessToken;
        const user = await firstOrCreateUser(token.user);
        const calendsoSession: Session = {
          ...session,
          user: {
            ...user,
            id: user.id as number,
            username: user.username as string,
          },
        };
        return calendsoSession;
      }
      return session;
    },
    /**
     * @param  {object}  token     Decrypted JSON Web Token
     * @param  {object}  user      User object      (only available on sign in)
     * @param  {object}  account   Provider account (only available on sign in)
     * @param  {object}  profile   Provider profile (only available on sign in)
     * @param  {boolean} isNewUser True if new user (only available on sign in)
     * @return {object}            JSON Web Token that will be saved
     */
    async jwt(token, user, account) {
      // Initial sign in
      if (account && user) {
        // Add access_token, refresh_token and expirations to the token right after signin
        token.accessToken = account.accessToken;
        token.refreshToken = account.refreshToken;
        token.accessTokenExpired = Date.now() + (account.expires_in - 15) * 1000;
        token.refreshTokenExpired = Date.now() + (account.refresh_expires_in - 15) * 1000;
        token.user = user;
        return token;
      }

      // Return previous token if the access token has not expired yet
      if (Date.now() < token.accessTokenExpired) return token;

      // Access token has expired, try to update it
      return refreshAccessToken(token);
    },
  },
});
