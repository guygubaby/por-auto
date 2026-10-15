<script setup lang="ts">
import { storeToRefs } from 'pinia';
import RunHistory from '../components/RunHistory.vue';
import { useConnectionStore } from '../useConnection';
definePage({ meta: { title: '运行记录', description: '查看步骤日志，批量导出调试 JSON 或清理本地记录。' } });
const connection = useConnectionStore();
const { resultRef, busyRef } = storeToRefs(connection);
</script>
<template><RunHistory :busy="busyRef" :run-timestamp="resultRef?.timestamp" @busy-change="connection.busyRef = $event" /></template>
