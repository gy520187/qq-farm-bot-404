import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface CollectionReward {
  itemId: number
  name: string
  count: string
  image: string
}

export interface CollectionBuff {
  id: number
  name: string
  value: number
  description: string
}

export interface CollectionItem {
  id: number
  name: string
  description: string
  image: string
  starLevel: number
  maxStarLevel: number
  ownCount: string
  activated: boolean
  isNew: boolean
  score: number
  displayed: boolean
  wished: boolean
  requirements: string[]
  nextStarCosts: CollectionReward[]
}

export interface CollectionSeries {
  id: number
  name: string
  rarity: number
  rarityName: string
  description: string
  requirements: string[]
  mutationRules: Array<{ name: string, probability: number, guarantee: number }>
  items: CollectionItem[]
  activatedCount: number
  totalCount: number
}

export interface CollectionSnapshot {
  category: number
  score: number
  claimedScore: number
  activatedCount: number
  totalCount: number
  nextRewardScore: number | null
  currentBuffs: CollectionBuff[]
  milestones: Array<{
    level: number
    score: number
    claimed: boolean
    reached: boolean
    rewards: CollectionReward[]
    buffs: CollectionBuff[]
  }>
  series: CollectionSeries[]
  display: { itemId: string, pedestalId: string } | null
  pedestals: Array<{ id: number, name: string, image: string, owned: boolean }>
  updatedAt: number
}

export const useCollectionsStore = defineStore('collections', () => {
  const data = ref<CollectionSnapshot | null>(null)
  const loading = ref(false)
  const error = ref('')
  let revision = 0

  function getErrorMessage(cause: any, fallback: string) {
    return cause?.response?.data?.error || cause?.data?.error || cause?.message || fallback
  }

  async function fetch(accountId: string) {
    if (!accountId)
      return
    const request = ++revision
    loading.value = true
    error.value = ''
    try {
      const { data: result } = await api.get('/api/collections', {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (request !== revision)
        return
      if (!result?.ok)
        throw new Error(result?.error || '藏品读取失败')
      data.value = result.data
    }
    catch (cause: any) {
      if (request === revision)
        error.value = getErrorMessage(cause, '藏品读取失败')
    }
    finally {
      if (request === revision)
        loading.value = false
    }
  }

  function reset() {
    revision++
    data.value = null
    loading.value = false
    error.value = ''
  }

  return { data, loading, error, fetch, reset }
})
