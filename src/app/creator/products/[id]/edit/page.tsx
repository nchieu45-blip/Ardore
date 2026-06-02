import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import EditProductForm from './EditProductForm'

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!creator) redirect('/creator/onboarding')

  const { data: product } = await supabase
    .from('products')
    .select('id, title, description, type, price, equipment, level, duration, is_published, thumbnail_url')
    .eq('id', id)
    .eq('creator_id', creator.id)
    .single()

  if (!product) notFound()

  return <EditProductForm product={product} />
}
