<script setup lang="ts">
import type { CVConnection, CVConnectionInput, CvStreamProtocol } from '~/composables/useCVConnections'

const props = defineProps<{ connection?: CVConnection | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()

const { t } = useI18n()
const { createConnection, updateConnection, testConnection } = useCVConnections()
const { models, fetchModels } = useCVModels()
const { fields, fetchFields } = useFields()

const name = ref('')
const protocol = ref<CvStreamProtocol>('rtsp')
const streamUrl = ref('')
const username = ref('')
const password = ref('')
const modelId = ref('')
const fieldId = ref<string | null>(null)

const loading = ref(false)
const testing = ref(false)
const testPassed = ref(false)
const testMessage = ref('')
const error = ref('')

const protocolItems = [
  { label: 'RTSP', value: 'rtsp' },
  { label: 'RTMP', value: 'rtmp' },
  { label: 'HTTP-MJPEG', value: 'http_mjpeg' }
]

const modelItems = computed(() =>
  models.value.map(m => ({ label: m.name, value: m.id }))
)

const fieldItems = computed(() => {
  const base = [{ label: '—', value: null as string | null }]
  return [
    ...base,
    ...fields.value.map(f => ({
      label: (f.name as string) ?? 'Field',
      value: f.id as string
    }))
  ]
})

const isEdit = computed(() => !!props.connection)

function reset() {
  name.value = ''
  protocol.value = 'rtsp'
  streamUrl.value = ''
  username.value = ''
  password.value = ''
  modelId.value = models.value[0]?.id ?? ''
  fieldId.value = null
  testPassed.value = false
  testMessage.value = ''
  error.value = ''
}

function loadFromConnection() {
  if (!props.connection) {
    reset()
    return
  }
  name.value = props.connection.name
  protocol.value = props.connection.protocol
  streamUrl.value = props.connection.streamUrl
  username.value = ''
  password.value = ''
  modelId.value = props.connection.modelId
  fieldId.value = props.connection.fieldId
  testPassed.value = isEdit.value
  testMessage.value = ''
  error.value = ''
}

function buildBody(): CVConnectionInput {
  return {
    name: name.value,
    protocol: protocol.value,
    streamUrl: streamUrl.value,
    username: username.value || undefined,
    password: password.value || undefined,
    modelId: modelId.value,
    fieldId: fieldId.value
  }
}

async function runTest() {
  if (!streamUrl.value || !modelId.value) return
  testing.value = true
  error.value = ''
  try {
    const res = await testConnection(buildBody())
    testPassed.value = res.ok
    testMessage.value = res.message
  } catch (e: unknown) {
    testPassed.value = false
    testMessage.value = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? t('detection.connections.testFail')
  } finally {
    testing.value = false
  }
}

function onAnyChange() {
  if (!isEdit.value) testPassed.value = false
}

async function save() {
  if (!testPassed.value && !isEdit.value) return
  loading.value = true
  error.value = ''
  try {
    if (isEdit.value && props.connection) {
      await updateConnection(props.connection.id, buildBody())
    } else {
      await createConnection(buildBody())
    }
    emit('saved')
    open.value = false
  } catch (e: unknown) {
    error.value = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Save failed'
  } finally {
    loading.value = false
  }
}

watch(open, async (v) => {
  if (v) {
    await Promise.all([fetchModels(), fetchFields()])
    loadFromConnection()
  }
})
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="isEdit ? t('common.edit') : t('detection.connections.create')"
  >
    <template #body>
      <form
        class="space-y-4"
        @submit.prevent="save"
      >
        <UAlert
          v-if="error"
          color="error"
          :title="error"
        />

        <UFormField
          :label="t('detection.connections.form.name')"
          required
        >
          <UInput
            v-model="name"
            required
            class="w-full"
            @update:model-value="onAnyChange"
          />
        </UFormField>

        <UFormField
          :label="t('detection.connections.form.protocol')"
          required
        >
          <USelect
            v-model="protocol"
            :items="protocolItems"
            class="w-full"
            @update:model-value="onAnyChange"
          />
        </UFormField>

        <UFormField
          :label="t('detection.connections.form.streamUrl')"
          required
        >
          <UInput
            v-model="streamUrl"
            placeholder="rtsp://192.168.1.10:554/stream"
            required
            class="w-full"
            @update:model-value="onAnyChange"
          />
        </UFormField>

        <UFormField :label="t('detection.connections.form.username')">
          <UInput
            v-model="username"
            autocomplete="off"
            class="w-full"
            @update:model-value="onAnyChange"
          />
        </UFormField>

        <UFormField :label="t('detection.connections.form.password')">
          <UInput
            v-model="password"
            type="password"
            autocomplete="new-password"
            class="w-full"
            @update:model-value="onAnyChange"
          />
        </UFormField>

        <UFormField
          :label="t('detection.connections.form.model')"
          required
        >
          <USelect
            v-model="modelId"
            :items="modelItems"
            required
            class="w-full"
            @update:model-value="onAnyChange"
          />
        </UFormField>

        <UFormField :label="t('detection.connections.form.field')">
          <USelect
            v-model="fieldId"
            :items="fieldItems"
            class="w-full"
            @update:model-value="onAnyChange"
          />
        </UFormField>

        <div class="space-y-2">
          <UButton
            type="button"
            variant="outline"
            :loading="testing"
            :disabled="!streamUrl || !modelId"
            @click="runTest"
          >
            {{ t('detection.connections.test') }}
          </UButton>
          <UAlert
            v-if="testMessage"
            :color="testPassed ? 'success' : 'error'"
            :title="testPassed ? t('detection.connections.testOk') : t('detection.connections.testFail')"
            :description="testMessage"
          />
        </div>

        <div class="flex gap-2 pt-2">
          <UButton
            type="submit"
            :loading="loading"
            :disabled="(!testPassed && !isEdit) || !name || !streamUrl || !modelId"
          >
            {{ t('common.save') }}
          </UButton>
          <UButton
            variant="outline"
            color="neutral"
            :disabled="loading"
            @click="open = false"
          >
            {{ t('common.cancel') }}
          </UButton>
        </div>
      </form>
    </template>
  </USlideover>
</template>
