export const config = {
  runtime: 'edge',
  schedule: '*/10 * * * *', // Cada 10 minutos
};

export default async function handler() {
  const url = 'https://synchat-ai-fnnh.vercel.app/api/health'; // ✅ TU URL REAL

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-internal-api-secret': process.env.INTERNAL_API_SECRET || '', // Opcional si usas auth
      },
    });

    if (!res.ok) throw new Error(`Status ${res.status}`);
    console.log('Warm-up successful.');
  } catch (err) {
    console.error('Warm-up failed:', err);
  }
}
