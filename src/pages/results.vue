<script setup lang="ts">
import { storeToRefs } from 'pinia';
import ResultPanel from '../components/ResultPanel.vue';
import { useConnectionStore } from '../useConnection';
definePage({ meta: { title: '运行结果', description: '查看本次工作流的输出内容和手机截图。' } });
const connection = useConnectionStore();
const { resultRef, busyRef } = storeToRefs(connection);
</script>
<template><ResultPanel :result="resultRef" :busy="busyRef" @open-results="connection.openResults" /></template>
