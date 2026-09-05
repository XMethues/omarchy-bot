import { useCallback, useEffect, useState, type JSX } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Badge } from "@astryxdesign/core/Badge";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";
import { useQuery } from "@tanstack/react-query";
import type { WorkingTreeDetailDto, WorkingTreeFileDto, WorkingTreeSummaryDto } from "@omarchy-bot/protocol";
import { api, apiErrorMessage } from "../lib/api.ts";

const STATUS_LABEL: Record<WorkingTreeFileDto["status"], string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  conflicted: "Conflicted",
  untracked: "Untracked",
};

const STATUS_COLOR: Record<WorkingTreeFileDto["status"], "blue" | "green" | "red" | "orange" | "purple" | "gray"> = {
  modified: "blue",
  added: "green",
  deleted: "red",
  renamed: "purple",
  conflicted: "orange",
  untracked: "gray",
};

function fileCountLabel(count: number): string {
  return `${count} changed ${count === 1 ? "file" : "files"}`;
}

function countLabel(file: WorkingTreeFileDto): string {
  if (file.counts.kind === "binary") return "Binary";
  if (file.counts.kind === "unknown") return "Counts unavailable";
  return `+${file.counts.additions} −${file.counts.deletions}`;
}

function FileRow({
  file,
  isSelected,
  onSelect,
}: {
  file: WorkingTreeFileDto;
  isSelected: boolean;
  onSelect: (path: string) => void;
}): JSX.Element {
  const isNew = file.status === "added" || file.status === "untracked";
  return (
    <ListItem
      label={file.path}
      description={file.previousPath === undefined
        ? STATUS_LABEL[file.status]
        : `Renamed from ${file.previousPath}`}
      startContent={<Token label={STATUS_LABEL[file.status]} color={STATUS_COLOR[file.status]} size="sm" />}
      endContent={
        <VStack gap={1} align="end">
          {isNew ? <Badge label="New" variant="green" /> : null}
          <Text type="supporting">{countLabel(file)}</Text>
        </VStack>
      }
      isSelected={isSelected}
      onClick={() => onSelect(file.path)}
    />
  );
}

function ReadyChanges({
  summary,
  selectedPath,
  onSelect,
}: {
  summary: Extract<WorkingTreeSummaryDto, { state: "ready" }>;
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
}): JSX.Element {
  const knownCounts = summary.additions === undefined || summary.deletions === undefined
    ? "Known line counts unavailable"
    : `Known line changes: +${summary.additions} −${summary.deletions}`;
  return (
    <VStack gap={4} padding={4} paddingBlockStart={3}>
      <VStack gap={1} role="status" aria-label="Working tree summary">
        <Text weight="semibold">{fileCountLabel(summary.changedFileCount)}</Text>
        <Text color="secondary">{knownCounts}</Text>
      </VStack>
      {summary.truncated ? (
        <Banner
          status="warning"
          container="section"
          title="Results truncated"
          description={`Showing ${summary.files.length} of ${summary.changedFileCount} changed files.`}
        />
      ) : null}
      <List density="compact" hasDividers header={<Heading level={4}>Files</Heading>}>
        {summary.files.map((file) => (
          <FileRow
            key={`${file.status}:${file.previousPath ?? ""}:${file.path}`}
            file={file}
            isSelected={selectedPath === file.path}
            onSelect={onSelect}
          />
        ))}
      </List>
    </VStack>
  );
}

function DetailContent({
  selectedPath,
  detail,
  onClose,
  onRetry,
}: {
  selectedPath: string;
  detail: {
    data: WorkingTreeDetailDto | undefined;
    error: Error | null;
    isPending: boolean;
  };
  onClose: () => void;
  onRetry: () => void;
}): JSX.Element {
  let body: JSX.Element;
  if (detail.error !== null) {
    body = (
      <Banner
        status="error"
        container="section"
        title="File detail unavailable"
        description={apiErrorMessage(detail.error, "This changed file could not be opened.")}
        endContent={<Button label="Retry detail" size="sm" variant="secondary" onClick={onRetry} />}
      />
    );
  } else if (detail.isPending || detail.data?.path !== selectedPath) {
    body = (
      <VStack gap={2} role="status" aria-label={`Loading detail for ${selectedPath}`} aria-busy="true">
        <Skeleton width="55%" height="var(--spacing-4)" radius={2} />
        <Skeleton width="100%" height="var(--spacing-12)" radius={2} index={1} />
      </VStack>
    );
  } else if (detail.data.kind === "binary") {
    body = (
      <Banner
        status="info"
        container="section"
        title="Binary file"
        description="A textual patch is not available. Line counts remain unspecified."
      />
    );
  } else if (detail.data.kind === "unknown") {
    body = (
      <Banner
        status="info"
        container="section"
        title="Text detail unavailable"
        description={detail.data.message}
      />
    );
  } else {
    body = (
      <VStack gap={3}>
        {detail.data.truncated ? (
          <Banner
            status="warning"
            container="section"
            title="File detail truncated"
            description="This patch reached the safe display limit and is incomplete."
          />
        ) : null}
        <CodeBlock
          code={detail.data.patch}
          language="diff"
          title={detail.data.path}
          width="100%"
          maxHeight="24rem"
          hasCopyButton={false}
          hasLineNumbers={false}
        />
      </VStack>
    );
  }

  const previousPath = detail.data?.path === selectedPath ? detail.data.previousPath : undefined;
  return (
    <VStack gap={3} padding={4} paddingBlockStart={0} aria-label={`File detail for ${selectedPath}`}>
      <HStack gap={2} vAlign="center">
        <StackItem size="fill">
          <VStack gap={1}>
            <Heading level={4}>{selectedPath}</Heading>
            {previousPath === undefined ? null : <Text color="secondary">Renamed from {previousPath}</Text>}
          </VStack>
        </StackItem>
        <Button label="Close detail" size="sm" variant="secondary" onClick={onClose} />
      </HStack>
      {body}
    </VStack>
  );
}

export interface ChangesPanelProps {
  botId: string;
  threadId?: string;
  selectedPath?: string;
  onSelectedPathChange: (path: string | undefined) => void;
}

/** Public working-tree summary. It exposes no filesystem-root input or mutation controls. */
export function ChangesPanel({
  botId,
  threadId,
  selectedPath,
  onSelectedPathChange,
}: ChangesPanelProps): JSX.Element {
  const [manualRefresh, setManualRefresh] = useState(false);
  const changes = useQuery({
    queryKey: ["working-tree-changes", botId, threadId ?? "blank"],
    queryFn: ({ signal }) =>
      api.workingTreeSummary({ botId, ...(threadId === undefined ? {} : { threadId }), signal }),
    refetchInterval: 15_000,
    staleTime: 0,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["working-tree-detail", botId, threadId ?? "blank", selectedPath ?? "none"],
    queryFn: ({ signal }) => {
      if (selectedPath === undefined) throw new Error("No changed file is selected.");
      return api.workingTreeDetail({
        botId,
        ...(threadId === undefined ? {} : { threadId }),
        path: selectedPath,
        signal,
      });
    },
    enabled: selectedPath !== undefined,
    staleTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (
      selectedPath !== undefined
      && changes.data !== undefined
      && (changes.data.state !== "ready" || !changes.data.files.some((file) => file.path === selectedPath))
    ) {
      onSelectedPathChange(undefined);
    }
  }, [changes.data, onSelectedPathChange, selectedPath]);

  const refresh = useCallback(async (): Promise<void> => {
    setManualRefresh(true);
    try {
      const result = await changes.refetch({ cancelRefetch: true });
      if (selectedPath === undefined) return;
      if (
        result.data?.state !== "ready"
        || !result.data.files.some((file) => file.path === selectedPath)
      ) {
        onSelectedPathChange(undefined);
        return;
      }
      await detail.refetch({ cancelRefetch: true });
    } finally {
      setManualRefresh(false);
    }
  }, [changes, detail, onSelectedPathChange, selectedPath]);

  let content: JSX.Element;
  if (changes.isPending) {
    content = (
      <VStack gap={3} padding={4} role="status" aria-label="Loading working tree changes" aria-busy="true">
        <Skeleton width="45%" height="var(--spacing-4)" radius={2} />
        <Skeleton width="100%" height="var(--spacing-10)" radius={2} index={1} />
        <Skeleton width="100%" height="var(--spacing-10)" radius={2} index={2} />
      </VStack>
    );
  } else if (changes.error !== null) {
    content = (
      <VStack padding={4}>
        <Banner
          status="error"
          container="section"
          title="Working tree changes unavailable"
          description={apiErrorMessage(changes.error, "The working tree could not be loaded.")}
          endContent={<Button label="Retry" size="sm" variant="secondary" onClick={() => void changes.refetch()} />}
        />
      </VStack>
    );
  } else if (changes.data.state === "unavailable") {
    content = (
      <VStack padding={4}>
        <Banner
          status="error"
          container="section"
          title="Working tree changes unavailable"
          description={changes.data.message}
          endContent={changes.data.retryable
            ? <Button label="Retry" size="sm" variant="secondary" onClick={() => void changes.refetch()} />
            : undefined}
        />
      </VStack>
    );
  } else if (changes.data.state === "clean") {
    content = (
      <EmptyState
        isCompact
        headingLevel={3}
        title="Working tree is clean"
        description="There are no uncommitted changes in this workspace."
        icon={<Icon icon="check" size="lg" />}
      />
    );
  } else if (changes.data.state === "not_repository") {
    content = (
      <EmptyState
        isCompact
        headingLevel={3}
        title="Not a Git repository"
        description="This conversation’s workspace is not inside a Git repository."
        icon={<Icon icon="info" size="lg" />}
      />
    );
  } else {
    content = (
      <>
        <ReadyChanges
          summary={changes.data}
          selectedPath={selectedPath}
          onSelect={onSelectedPathChange}
        />
        {selectedPath === undefined ? null : (
          <DetailContent
            selectedPath={selectedPath}
            detail={detail}
            onClose={() => onSelectedPathChange(undefined)}
            onRetry={() => void detail.refetch()}
          />
        )}
      </>
    );
  }

  return (
    <VStack gap={0} height="100%" data-testid="working-tree-changes">
      <HStack gap={2} padding={4} paddingBlockEnd={0} vAlign="center">
        <StackItem size="fill">
          <Heading level={3}>Working tree changes</Heading>
        </StackItem>
        <Button
          label="Refresh changes"
          size="sm"
          variant="secondary"
          isLoading={manualRefresh}
          onClick={() => void refresh()}
        />
      </HStack>
      {content}
    </VStack>
  );
}
