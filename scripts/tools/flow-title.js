export function flowActionTitle(state)
{
    if (state?.name === 'TalentFlow' && state.data?.rank?.name)
        return state.data.rank.name;
    return state?.data?.title || null;
}
