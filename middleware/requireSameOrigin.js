const allowedOrigins = () => {
  const configured = process.env.CLIENT_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean);
  return configured?.length ? configured : ["https://fixlab-repair.vercel.app"];
};

export const requireSameOrigin = (req, res, next) => {
  const origin = req.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) {
    return res.status(403).json({ message: "Request origin is not allowed" });
  }
  next();
};
