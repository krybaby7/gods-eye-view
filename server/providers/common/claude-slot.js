let owner = null;

/** Reserve the subscription across both steps of a Search or Refresh. */
export const claudeSlot = {
  owner: () => owner,
  claim(purpose) {
    if (owner !== null) return null;
    owner = purpose;
    return () => {
      owner = null;
    };
  },
};
