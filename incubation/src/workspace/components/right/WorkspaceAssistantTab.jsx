import React, { useState, useRef, useEffect } from 'react';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';

const defaultMessages = [
  {
    id: 'msg-1',
    sender: 'assistant',
    text: 'Hello! I am your Linkx AI Assistant. How can I help analyze your active workspace today?',
    timestamp: '10:24 AM',
  },
  {
    id: 'msg-2',
    sender: 'user',
    text: 'Can you summarize active telemetry and window states?',
    timestamp: '10:25 AM',
  },
  {
    id: 'msg-3',
    sender: 'assistant',
    text: 'Workspace status is active. All system telemetry streams and visual graph engines are operating normally.',
    timestamp: '10:25 AM',
  },
];

const quickPrompts = [
  'Analyze this graph',
  'Identify critical nodes',
  'Identify clusters',
  'Summarize the graph',
  'Guide me to analyze the graph',
];

const MAX_WORD_LIMIT = 100;

function getWordCount(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function LinkxBotIcon({ logoSrc }) {
  const defaultLogo = (import.meta.env.BASE_URL || '/') + 'site_images/Linkx square Icon (256x256).png';
  const src = logoSrc || defaultLogo;
  return (
    <img
      src={src}
      alt="Linkx logo"
      className="workspace_chat_bot_logo"
    />
  );
}

function GlobeIcon() {
  return (
    <svg className="workspace_assistant_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10z" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg className="workspace_assistant_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="workspace_chat_bubble_action_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="workspace_chat_bubble_action_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="workspace_chat_bubble_action_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg className="workspace_assistant_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="workspace_assistant_icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="workspace_chat_scroll_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function WorkspaceAssistantTab({ displayName, workspace, logoSrc }) {
  const [message, setMessage] = useState('');
  const [chatMessages, setChatMessages] = useState(defaultMessages);
  const [isAssistantResponding, setIsAssistantResponding] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);

  // Hover copy & edit state
  const [copiedId, setCopiedId] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);

  const messagesEndRef = useRef(null);
  const chatBodyRef = useRef(null);
  const inputRef = useRef(null);
  const responseTimerRef = useRef(null);

  let notify = null;
  try {
    const notifications = useNotifications();
    notify = notifications?.notify;
  } catch {
    // Fallback if rendered outside NotificationProvider
  }

  const handleResetChat = () => {
    if (responseTimerRef.current) {
      clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    setChatMessages([
      {
        id: `msg-${Date.now()}`,
        sender: 'assistant',
        text: 'Chat instance reset. How can I help analyze your workspace today?',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setMessage('');
    setEditingMessageId(null);
    setIsAssistantResponding(false);
  };

  const handleStopGeneration = () => {
    if (responseTimerRef.current) {
      clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    setIsAssistantResponding(false);
    if (notify) {
      notify({
        level: 'info',
        title: 'Response Interrupted',
        message: 'Co-analyst response generation was stopped.',
      });
    }
  };

  const handleCopyMessage = (msgId, text) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    setCopiedId(msgId);
    setTimeout(() => {
      setCopiedId(null);
    }, 1800);
  };

  // Populate message text into main input field & set focus
  const handleStartEdit = (msg) => {
    setMessage(msg.text);
    setEditingMessageId(msg.id);
    inputRef.current?.focus();
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setMessage('');
  };

  const handleChatBodyScroll = () => {
    if (!chatBodyRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatBodyRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    // Show floating button if user has scrolled up by > 70px
    if (distanceFromBottom > 70) {
      setShowScrollBottomBtn(true);
    } else {
      setShowScrollBottomBtn(false);
    }
  };

  const handleScrollToBottom = () => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTo({
        top: chatBodyRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
    setShowScrollBottomBtn(false);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, isAssistantResponding]);

  // Auto re-focus input field whenever assistant response finishes
  useEffect(() => {
    if (!isAssistantResponding) {
      inputRef.current?.focus();
    }
  }, [isAssistantResponding]);

  // Dynamically expand textarea height up to 10 lines (170px) as user types/edits
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const targetHeight = Math.min(inputRef.current.scrollHeight, 170);
      inputRef.current.style.height = `${Math.max(targetHeight, 38)}px`;
    }
  }, [message]);

  const currentWordCount = getWordCount(message);
  const isWordLimitExceeded = currentWordCount > MAX_WORD_LIMIT;

  const handleTextChange = (event) => {
    const newText = event.target.value;
    const newWordCount = getWordCount(newText);
    // Allow typing up to MAX_WORD_LIMIT words or deleting characters
    if (newWordCount <= MAX_WORD_LIMIT || newText.length < message.length) {
      setMessage(newText);
    } else {
      // If typing single word exceeds limit, trim to exactly 100 words
      const words = newText.trim().split(/\s+/);
      if (words.length > MAX_WORD_LIMIT) {
        setMessage(words.slice(0, MAX_WORD_LIMIT).join(' '));
        if (notify) {
          notify({
            level: 'warning',
            title: 'Word Limit Reached',
            message: 'Input text was automatically trimmed to the 100-word limit.',
          });
        }
      }
    }
  };

  // Paste handler: if pasted text causes total words > 100, cut out 100 words & show notification
  const handlePaste = (e) => {
    const pasteData = e.clipboardData?.getData('text');
    if (!pasteData) return;

    const target = e.target;
    const selectionStart = target.selectionStart ?? message.length;
    const selectionEnd = target.selectionEnd ?? message.length;

    const beforeSelection = message.slice(0, selectionStart);
    const afterSelection = message.slice(selectionEnd);
    const beforeWordsCount = getWordCount(beforeSelection);
    const afterWordsCount = getWordCount(afterSelection);
    const pasteWordsArray = pasteData.trim().split(/\s+/).filter(Boolean);

    const totalWordsIfPasted = beforeWordsCount + pasteWordsArray.length + afterWordsCount;

    if (totalWordsIfPasted > MAX_WORD_LIMIT) {
      e.preventDefault();
      const remainingSlots = Math.max(0, MAX_WORD_LIMIT - (beforeWordsCount + afterWordsCount));

      if (remainingSlots <= 0) {
        if (notify) {
          notify({
            level: 'warning',
            title: 'Word Limit Reached',
            message: 'Cannot paste. Input has already reached the 100-word limit.',
          });
        }
        return;
      }

      const truncatedPasteText = pasteWordsArray.slice(0, remainingSlots).join(' ');
      const prefixSpace = beforeSelection && !beforeSelection.endsWith(' ') ? ' ' : '';
      const suffixSpace = afterSelection && !afterSelection.startsWith(' ') ? ' ' : '';
      const finalMessage = `${beforeSelection}${prefixSpace}${truncatedPasteText}${suffixSpace}${afterSelection}`.trim();

      setMessage(finalMessage);

      if (notify) {
        notify({
          level: 'warning',
          title: 'Word Limit Reached',
          message: 'Pasted content was automatically trimmed to fit the 100-word limit.',
        });
      }
    }
  };

  const trimmedMessage = message.trim();
  const isSubmitDisabled = !trimmedMessage || isAssistantResponding || isWordLimitExceeded;

  const handleSubmit = (event) => {
    if (event) event.preventDefault();
    if (isSubmitDisabled) return;

    const userMsgText = trimmedMessage;
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (editingMessageId) {
      // Update existing message text in-place
      setChatMessages((prev) =>
        prev.map((m) => (m.id === editingMessageId ? { ...m, text: userMsgText, timestamp: nowTime } : m))
      );
      setEditingMessageId(null);
    } else {
      // Append new user message
      const userMsg = {
        id: `msg-${Date.now()}`,
        sender: 'user',
        text: userMsgText,
        timestamp: nowTime,
      };
      setChatMessages((prev) => [...prev, userMsg]);
    }

    setMessage('');
    setIsAssistantResponding(true);

    if (responseTimerRef.current) {
      clearTimeout(responseTimerRef.current);
    }

    responseTimerRef.current = setTimeout(() => {
      const aiMsg = {
        id: `msg-ai-${Date.now()}`,
        sender: 'assistant',
        text: `Received request: "${userMsgText}". Workspace telemetry parameters updated cleanly.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, aiMsg]);
      setIsAssistantResponding(false);
      responseTimerRef.current = null;
    }, 1200);
  };

  // Keyboard shortcut: Enter to submit, Shift+Enter for newline
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleQuickPromptClick = (promptText) => {
    if (isAssistantResponding) return;

    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: promptText,
      timestamp: nowTime,
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setIsAssistantResponding(true);

    if (responseTimerRef.current) {
      clearTimeout(responseTimerRef.current);
    }

    responseTimerRef.current = setTimeout(() => {
      let responseText = `Received request: "${promptText}".`;
      if (promptText === 'Analyze this graph') {
        responseText = 'Analyzing graph topology... 65 active nodes and 120 connecting edges are active with 0 anomalies.';
      } else if (promptText === 'Identify critical nodes') {
        responseText = 'Critical node evaluation complete: Node #12 ("Main Gateway") and Node #45 ("Central Hub") identified as critical infrastructure bottlenecks.';
      } else if (promptText === 'Identify clusters') {
        responseText = 'Cluster detection complete: 4 distinct community clusters identified across telecommunication & entity relations.';
      } else if (promptText === 'Summarize the graph') {
        responseText = 'Graph Overview: 65 entities, 120 relationships, 4 primary clusters, average degree: 3.69, max depth: 5 layers.';
      } else if (promptText === 'Guide me to analyze the graph') {
        responseText = 'Guided Analysis Initiated: Step 1 — Scanning topology parameters. Step 2 — Measuring node centrality. Step 3 — Mapping community clusters.';
      }

      const aiMsg = {
        id: `msg-ai-${Date.now()}`,
        sender: 'assistant',
        text: responseText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, aiMsg]);
      setIsAssistantResponding(false);
      responseTimerRef.current = null;
    }, 1100);
  };

  return (
    <div className="workspace_assistant_tab_wrapper">
      <div className="workspace_assistant_header">
        <div className="workspace_assistant_title_group">
          <span
            className="workspace_assistant_status_dot linkx_tooltip_anchor"
            data-tooltip="Co-analyst Active"
            aria-label="Co-analyst Active"
          />
          <h3>Linkx AI Co-analyst</h3>
        </div>
        <div className="workspace_assistant_actions">
          {/* 1. Language Button (disabled) */}
          <button
            type="button"
            className="workspace_assistant_action_btn linkx_tooltip_anchor"
            data-tooltip="Language (disabled)"
            aria-label="Language"
            disabled
          >
            <GlobeIcon />
          </button>

          {/* 2. Reset Chat Button */}
          <button
            type="button"
            className="workspace_assistant_action_btn linkx_tooltip_anchor"
            data-tooltip="Reset chat"
            aria-label="Reset chat"
            onClick={handleResetChat}
          >
            <ResetIcon />
          </button>
        </div>
      </div>

      {/* Outer viewport container for chat body + floating scroll overlay */}
      <div className="workspace_context_chat_body_container">
        <div
          ref={chatBodyRef}
          className="workspace_context_chat_body"
          onScroll={handleChatBodyScroll}
        >
          {chatMessages.map((msg) => (
            <div key={msg.id} className={`workspace_chat_bubble_wrapper is-${msg.sender}`}>
              <div className="workspace_chat_bubble_avatar" aria-hidden="true">
                {msg.sender === 'user' ? (
                  displayName.charAt(0).toUpperCase() || 'U'
                ) : (
                  <LinkxBotIcon logoSrc={logoSrc} />
                )}
              </div>
              <div className="workspace_chat_bubble_content">
                <p className="workspace_chat_bubble_text">{msg.text}</p>
                <div className="workspace_chat_bubble_footer">
                  <span className="workspace_chat_bubble_time">{msg.timestamp}</span>
                  {/* Action Toolbar placed directly under bubble */}
                  <div className="workspace_chat_bubble_hover_actions">
                    <button
                      type="button"
                      className="workspace_chat_bubble_action_btn linkx_tooltip_anchor"
                      data-tooltip={copiedId === msg.id ? 'Copied!' : 'Copy message'}
                      aria-label="Copy message"
                      onClick={() => handleCopyMessage(msg.id, msg.text)}
                    >
                      {copiedId === msg.id ? <CheckIcon /> : <CopyIcon />}
                    </button>
                    {msg.sender === 'user' && (
                      <button
                        type="button"
                        className="workspace_chat_bubble_action_btn linkx_tooltip_anchor"
                        data-tooltip="Edit message"
                        aria-label="Edit message"
                        onClick={() => handleStartEdit(msg)}
                      >
                        <EditIcon />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Animated Thinking Bubble when AI is generating a response */}
          {isAssistantResponding && (
            <div className="workspace_chat_bubble_wrapper is-assistant is-thinking">
              <div className="workspace_chat_bubble_avatar" aria-hidden="true">
                <LinkxBotIcon logoSrc={logoSrc} />
              </div>
              <div className="workspace_chat_bubble_content">
                <div className="workspace_chat_bubble_text workspace_chat_thinking_bubble" aria-label="Thinking for response">
                  <span className="workspace_chat_dot" />
                  <span className="workspace_chat_dot" />
                  <span className="workspace_chat_dot" />
                </div>
              </div>
            </div>
          )}

          {/* Quick Starter Option Prompts */}
          <div className="workspace_chat_quick_prompts" aria-label="Suggested prompts">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="workspace_chat_prompt_pill"
                disabled={isAssistantResponding}
                onClick={() => handleQuickPromptClick(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div ref={messagesEndRef} />
        </div>

        {/* Floating Scroll-Down Action Overlay Button pinned to chat viewport */}
        {showScrollBottomBtn && (
          <button
            type="button"
            className="workspace_chat_scroll_bottom_btn linkx_tooltip_anchor"
            data-tooltip="Scroll to bottom"
            aria-label="Scroll to bottom"
            onClick={handleScrollToBottom}
          >
            <ChevronDownIcon />
          </button>
        )}
      </div>

      <form className="workspace_context_chat_form" aria-label="Assistant message" onSubmit={handleSubmit}>
        <div className="workspace_chat_input_container">
          <textarea
            ref={inputRef}
            rows={1}
            value={message}
            placeholder={editingMessageId ? 'Edit your message...' : 'Message assistant...'}
            disabled={isAssistantResponding}
            onChange={handleTextChange}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
          />
          {message.length > 0 && (
            <span
              className={`workspace_chat_word_counter${
                currentWordCount > 90 ? ' is-near-limit' : ''
              }`}
            >
              {currentWordCount} / {MAX_WORD_LIMIT} words
            </span>
          )}
        </div>
        {isAssistantResponding ? (
          <button
            type="button"
            className="workspace_chat_stop_btn linkx_tooltip_anchor"
            data-tooltip="Stop generating"
            aria-label="Stop generating"
            onClick={handleStopGeneration}
          >
            <StopIcon />
          </button>
        ) : editingMessageId ? (
          <button
            type="button"
            className="workspace_assistant_action_btn linkx_tooltip_anchor"
            data-tooltip="Cancel edit"
            aria-label="Cancel edit"
            onClick={handleCancelEdit}
          >
            <CancelIcon />
          </button>
        ) : (
          <button
            type="submit"
            className="linkx_tooltip_anchor"
            data-tooltip="Send message"
            disabled={isSubmitDisabled}
            aria-label="Send message"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h13m0 0-5-5m5 5-5 5" />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
