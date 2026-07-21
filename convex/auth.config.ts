const authConfig = {
  providers: [
    {
      // Set CLERK_JWT_ISSUER_DOMAIN on the Convex deployment (dev + prod):
      // Clerk dashboard -> JWT templates -> "convex" template -> issuer.
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: 'convex',
    },
  ],
};

export default authConfig;
