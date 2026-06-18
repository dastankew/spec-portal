import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_URL.startsWith('http')) {
  console.error(
    '[spec-portal] VITE_SUPABASE_URL не задан или некорректен. ' +
    'Проверьте переменные окружения Vercel и пересоберите проект.'
  )
}

export const supabase = (SUPABASE_URL && SUPABASE_URL.startsWith('http'))
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null
