import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, MessageSquare, Flag } from 'lucide-react';
import VoteControl from './VoteControl';
import * as api from '../../api/spaces';

// The comment tree.
//
// THIS IS THE HARDEST ACCESSIBILITY SURFACE IN THE PRODUCT, and the one most
// commonly shipped as a pile of nested divs that a keyboard cannot enter.
//
// It implements the WAI-ARIA tree pattern properly:
//
//   - role="tree" on the container, role="treeitem" on every node.
//   - aria-expanded ONLY on nodes that actually have children. Putting it on a
//     leaf tells a screen reader there is something to open when there is not.
//   - aria-level, aria-posinset and aria-setsize, so "3 of 7, level 2" is
//     announced — the only way to understand nesting without seeing indentation.
//   - ROVING TABINDEX: exactly one node is tabbable at a time. The alternative,
//     every comment in the tab order, means tabbing past a 500-comment thread
//     to reach the reply box.
//   - Arrow keys per the pattern: Down/Up move through VISIBLE nodes, Right
//     expands or descends, Left collapses or ascends, Home/End jump to the ends.
//
// The server sends a flat array with `depth` and `parent`; the tree is assembled
// here. Nested JSON would waste bytes and make pagination inside a thread
// awkward.

const relative = (date) => {
  const minutes = Math.floor((Date.now() - new Date(date)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
};

/** Flat list -> nested. Orphans (parent not in this page) are treated as roots. */
const buildTree = (comments) => {
  const byId = new Map();
  const roots = [];
  comments.forEach((c) => byId.set(c.id, { ...c, children: [] }));
  comments.forEach((c) => {
    const node = byId.get(c.id);
    const parent = c.parent ? byId.get(c.parent) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
};

/**
 * Depth-first list of nodes that are currently VISIBLE.
 *
 * Arrow-key navigation moves through this, not through the whole tree —
 * pressing Down must not land on something inside a collapsed thread.
 */
const flattenVisible = (nodes, collapsed, level = 1, out = []) => {
  nodes.forEach((node, index) => {
    out.push({ node, level, index, siblings: nodes.length });
    if (node.children.length && !collapsed.has(node.id)) {
      flattenVisible(node.children, collapsed, level + 1, out);
    }
  });
  return out;
};

const CommentNode = ({
  node, level, index, siblings, collapsed, onToggle, focusedId, setFocusedId,
  onReply, onReport, onLoadReplies, canComment, loadingReplies, registerRef,
  replyingToId, renderReplyForm,
}) => {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const tombstoned = Boolean(node.tombstone);
  const hiddenChildren = (node.directReplyCount || 0) - node.children.length;

  return (
    <li
      role="treeitem"
      // Only where there is something to expand. On a leaf it is a lie.
      {...(hasChildren ? { 'aria-expanded': !isCollapsed } : {})}
      aria-level={level}
      aria-posinset={index + 1}
      aria-setsize={siblings}
      // Roving tabindex: one tab stop for the whole tree.
      tabIndex={focusedId === node.id ? 0 : -1}
      ref={(el) => registerRef(node.id, el)}
      onFocus={(e) => { e.stopPropagation(); setFocusedId(node.id); }}
      className="scroll-mt-20 outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-1 focus-visible:ring-offset-night"
    >
      <div className={`flex gap-2 rounded-lg py-1.5 ${level > 1 ? 'border-l border-line pl-3' : ''}`}>
        {hasChildren && (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            // The tree item owns the expanded state; this button is a pointer
            // affordance for the same thing, so it is hidden from the a11y tree
            // to avoid announcing it twice.
            aria-hidden="true"
            tabIndex={-1}
            className="mt-1 h-fit cursor-pointer text-silver-muted hover:text-silver"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-silver-muted">
            {tombstoned ? (
              <span className="italic">[{node.tombstone}]</span>
            ) : (
              <Link to={`/u/${node.author?.username}`} className="font-medium text-silver hover:text-crimson-soft">
                {node.author?.username || '[deleted]'}
              </Link>
            )}
            {node.isOp && (
              <span className="rounded bg-sky-500/15 px-1 text-[10px] font-semibold text-sky-300">OP</span>
            )}
            <time dateTime={node.createdAt}>{relative(node.createdAt)}</time>
            {node.editedAt && <span className="italic">edited</span>}
            {isCollapsed && hasChildren && (
              <span className="text-silver">({node.replyCount + 1} collapsed)</span>
            )}
          </div>

          {!isCollapsed && (
            <>
              {tombstoned ? (
                <p className="mt-1 text-sm italic text-silver-muted">
                  {node.tombstone === 'removed'
                    ? `Removed by a moderator${node.removedReason ? `: ${node.removedReason}` : ''}`
                    : 'Deleted by the author'}
                </p>
              ) : (
                <div
                  className="mt-1 text-sm text-silver [&_a]:text-sky-400"
                  // Sanitized server-side on write; CSP is the backstop.
                  dangerouslySetInnerHTML={{ __html: node.body }}
                />
              )}

              <div className="mt-1 flex items-center gap-3">
                {!tombstoned && <VoteControl post={node} orientation="horizontal" size="sm" target="comment" />}
                {canComment && !tombstoned && (
                  <button
                    type="button"
                    onClick={() => onReply(node)}
                    tabIndex={-1}
                    className="flex cursor-pointer items-center gap-1 text-xs text-silver-muted hover:text-silver"
                  >
                    <MessageSquare className="h-3 w-3" aria-hidden="true" /> Reply
                  </button>
                )}
                {!tombstoned && (
                  <button
                    type="button"
                    onClick={() => onReport(node)}
                    tabIndex={-1}
                    aria-label={`Report comment by ${node.author?.username || 'deleted user'}`}
                    className="flex cursor-pointer items-center gap-1 text-xs text-silver-muted hover:text-silver"
                  >
                    <Flag className="h-3 w-3" aria-hidden="true" /> Report
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* THE REPLY BOX BELONGS HERE, not in one fixed spot at the top of the
          thread. Replying to comment #180 and having the input appear off
          screen above comment #1 is the single most disorienting thing a
          comment UI can do — you lose sight of what you are answering.

          role="none" because a <form> is not a tree node. Without it the
          treeitem gains a child that assistive tech tries to interpret as
          part of the tree structure. */}
      {replyingToId === node.id && (
        <div role="none" className={level > 1 ? 'ml-3' : ''}>
          {renderReplyForm()}
        </div>
      )}

      {hasChildren && !isCollapsed && (
        <ul role="group" className="ml-2">
          {node.children.map((child, i) => (
            <CommentNode
              key={child.id}
              node={child}
              level={level + 1}
              index={i}
              siblings={node.children.length}
              collapsed={collapsed}
              onToggle={onToggle}
              focusedId={focusedId}
              setFocusedId={setFocusedId}
              onReply={onReply}
              onReport={onReport}
              onLoadReplies={onLoadReplies}
              canComment={canComment}
              loadingReplies={loadingReplies}
              registerRef={registerRef}
              replyingToId={replyingToId}
              renderReplyForm={renderReplyForm}
            />
          ))}
        </ul>
      )}

      {/* Replies exist beyond what this page carried. A button, not an
          auto-expand — a 4,000-reply subtree must be an explicit choice. */}
      {!isCollapsed && hiddenChildren > 0 && (
        <button
          type="button"
          onClick={() => onLoadReplies(node)}
          disabled={loadingReplies === node.id}
          className="ml-6 cursor-pointer text-xs text-crimson-soft hover:underline disabled:opacity-50"
        >
          {loadingReplies === node.id
            ? 'Loading…'
            : `${hiddenChildren} more ${hiddenChildren === 1 ? 'reply' : 'replies'}`}
        </button>
      )}
    </li>
  );
};

const CommentTree = ({
  comments, canComment, onReply, onReport, postId, onMerge,
  replyingToId, renderReplyForm,
}) => {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [focusedId, setFocusedId] = useState(null);
  const [loadingReplies, setLoadingReplies] = useState(null);
  const refs = useRef(new Map());

  const tree = useMemo(() => buildTree(comments), [comments]);
  const visible = useMemo(() => flattenVisible(tree, collapsed), [tree, collapsed]);

  // The first node is the tree's single tab stop until something else is
  // focused. Without this the tree is unreachable by keyboard entirely.
  useEffect(() => {
    if (!focusedId && visible.length) setFocusedId(visible[0].node.id);
  }, [focusedId, visible]);

  const registerRef = useCallback((id, el) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  }, []);

  const toggle = useCallback((id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const focus = useCallback((id) => {
    setFocusedId(id);
    const el = refs.current.get(id);
    if (el) el.focus();
  }, []);

  const loadReplies = useCallback(async (node) => {
    setLoadingReplies(node.id);
    try {
      const data = await api.getReplies(node.id, { limit: 50 });
      onMerge(data.comments);
    } finally {
      setLoadingReplies(null);
    }
  }, [onMerge]);

  /**
   * The WAI-ARIA tree keyboard contract.
   *
   * Handled on the container rather than per node, so there is one
   * implementation and the roving tabindex stays consistent.
   */
  const onKeyDown = (event) => {
    // The reply box now lives INSIDE the tree, and this handler is on the
    // container, so it would otherwise swallow every arrow key typed into the
    // textarea — no cursor movement, no Home/End, and Enter firing "reply"
    // mid-sentence. Editable targets own their own keys.
    const tag = event.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || event.target.isContentEditable) {
      return;
    }

    const position = visible.findIndex((v) => v.node.id === focusedId);
    if (position === -1) return;
    const current = visible[position];
    const hasChildren = current.node.children.length > 0;
    const isCollapsed = collapsed.has(current.node.id);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (position < visible.length - 1) focus(visible[position + 1].node.id);
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (position > 0) focus(visible[position - 1].node.id);
        break;

      case 'ArrowRight':
        event.preventDefault();
        // Closed with children -> open it. Already open -> step into it.
        if (hasChildren && isCollapsed) toggle(current.node.id);
        else if (hasChildren && position < visible.length - 1) focus(visible[position + 1].node.id);
        break;

      case 'ArrowLeft':
        event.preventDefault();
        // Open -> close it. Already closed (or a leaf) -> go to the parent,
        // which is the nearest preceding node at a shallower level.
        if (hasChildren && !isCollapsed) {
          toggle(current.node.id);
        } else {
          for (let i = position - 1; i >= 0; i -= 1) {
            if (visible[i].level < current.level) { focus(visible[i].node.id); break; }
          }
        }
        break;

      case 'Home':
        event.preventDefault();
        if (visible.length) focus(visible[0].node.id);
        break;

      case 'End':
        event.preventDefault();
        if (visible.length) focus(visible[visible.length - 1].node.id);
        break;

      case 'Enter':
        if (canComment) { event.preventDefault(); onReply(current.node); }
        break;

      default:
        break;
    }
  };

  if (!comments.length) {
    return (
      <p className="py-8 text-center text-sm text-silver-muted">
        No comments yet. Be the first.
      </p>
    );
  }

  return (
    <>
      {/* Announced on entry, so the size of the thread is known before
          navigating it. */}
      <p className="sr-only" id={`tree-help-${postId}`}>
        {comments.length} comments. Use arrow keys to move between them, left and
        right to collapse and expand.
      </p>
      <ul
        role="tree"
        aria-label="Comments"
        aria-describedby={`tree-help-${postId}`}
        onKeyDown={onKeyDown}
        className="space-y-1"
      >
        {tree.map((node, i) => (
          <CommentNode
            key={node.id}
            node={node}
            level={1}
            index={i}
            siblings={tree.length}
            collapsed={collapsed}
            onToggle={toggle}
            focusedId={focusedId}
            setFocusedId={setFocusedId}
            onReply={onReply}
            onReport={onReport}
            onLoadReplies={loadReplies}
            canComment={canComment}
            loadingReplies={loadingReplies}
            registerRef={registerRef}
            replyingToId={replyingToId}
            renderReplyForm={renderReplyForm}
          />
        ))}
      </ul>
    </>
  );
};

export default CommentTree;
export { buildTree, flattenVisible };
