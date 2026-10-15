<script setup lang="ts">
import { storeToRefs } from 'pinia';
import WorkflowStore from '../components/WorkflowStore.vue';
import { useConnectionStore } from '../useConnection';
definePage({ meta: { title: '工作流商店', description: '添加 GitHub Registry，安装与更新工作流。所有配置保存在本机。' } });
const connection = useConnectionStore();
const { storeRef, busyRef } = storeToRefs(connection);
</script>
<template><WorkflowStore :store="storeRef" :busy="busyRef" @sync="connection.syncRegistry" @install="connection.installWorkflow" /></template>
